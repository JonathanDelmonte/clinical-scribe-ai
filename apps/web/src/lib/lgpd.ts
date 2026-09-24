import "server-only";

import {
  auditLog,
  documents,
  jobs,
  objectiveTemplates,
  patients,
  professionals,
  sessions,
  transcriptSegments,
  usageEvents,
  type Database,
} from "@scribe/db";
import { arquivosDaGravacao } from "@scribe/storage";
import { asc, desc, eq, isNotNull, sql } from "drizzle-orm";

import { ACOES, auditar } from "./audit";
import type { Professional, Tx } from "./auth";
import { getDb } from "./db";
import { storage } from "./storage";

/**
 * Os direitos do titular — LGPD Art. 18.
 *
 * Dois deles, os que exigem código: **portabilidade** (levar os dados embora,
 * em formato legível por máquina) e **eliminação** (apagar a conta e tudo o
 * que veio com ela).
 *
 * Os dois são do profissional sobre os próprios dados. Sobre os dados dos
 * pacientes dele, quem é controlador é ele — e é por isso que a tela de
 * exclusão fala de obrigação de guarda de prontuário antes de fazer qualquer
 * coisa. Ver o aviso em `/configuracoes/dados`.
 */

export interface DadosExportados {
  readonly formato: "consulta-viva/exportacao";
  readonly versao: 1;
  readonly geradoEm: string;
  readonly profissional: unknown;
  readonly pacientes: unknown[];
  readonly consultas: unknown[];
  readonly trechos: unknown[];
  readonly documentos: unknown[];
  readonly uso: unknown[];
  readonly auditoria: unknown[];
  readonly observacoes: readonly string[];
}

/**
 * Tudo o que é do profissional, em JSON.
 *
 * Roda sob RLS, com a identidade dele: a exportação não enxerga nada que ele
 * já não pudesse ler pela interface. É o que torna esta rota incapaz de virar
 * um vazamento mesmo se o filtro fosse escrito errado.
 *
 * O que NÃO vai junto é o áudio — são megabytes por consulta, e um JSON com
 * eles em base64 seria um arquivo que nenhum navegador abre. O campo
 * `audioPath` fica no lugar, para que a ausência seja visível em vez de
 * silenciosa.
 */
export async function exportarDados(
  tx: Tx,
  me: Professional,
): Promise<DadosExportados> {
  const [meusPacientes, minhasConsultas, meusTrechos, meusDocumentos, meuUso, trilha] =
    await Promise.all([
      tx.select().from(patients).orderBy(asc(patients.createdAt)),
      tx.select().from(sessions).orderBy(asc(sessions.createdAt)),
      tx
        .select()
        .from(transcriptSegments)
        .orderBy(asc(transcriptSegments.sessionId), asc(transcriptSegments.startMs)),
      tx.select().from(documents).orderBy(asc(documents.createdAt)),
      tx.select().from(usageEvents).orderBy(asc(usageEvents.createdAt)),
      tx.select().from(auditLog).orderBy(desc(auditLog.createdAt)),
    ]);

  // O hash da senha sai do perfil exportado. Ele é dado sobre a conta, não
  // dado do titular, e um arquivo baixado carregando credencial é um arquivo
  // que vaza credencial quando alguém o compartilha sem pensar.
  const { passwordHash: _hash, voiceEmbedding: _voz, ...perfil } = me;

  return {
    formato: "consulta-viva/exportacao",
    versao: 1,
    geradoEm: new Date().toISOString(),
    profissional: perfil,
    pacientes: meusPacientes,
    consultas: minhasConsultas,
    trechos: meusTrechos,
    documentos: meusDocumentos,
    uso: meuUso,
    auditoria: trilha,
    observacoes: [
      "O áudio das consultas não está neste arquivo: são megabytes por consulta. " +
        "O campo audioPath indica onde cada um estava.",
      "A impressão vocal do profissional não é exportada — é um vetor numérico " +
        "sem uso fora deste sistema.",
      "O hash da senha não é exportado.",
    ],
  };
}

export interface ResultadoDaExclusao {
  readonly audiosApagados: number;
  readonly pacientes: number;
  readonly consultas: number;
  readonly documentos: number;
}

/**
 * Apaga a conta e tudo o que veio com ela.
 *
 * ## Por que isto roda com privilégio, e não sob RLS
 *
 * A identidade é resolvida ANTES, a partir da sessão autenticada, e é a única
 * coisa que atravessa a fronteira: nenhum identificador vem da requisição.
 * Dentro, a exclusão precisa alcançar duas tabelas que a RLS **corretamente**
 * impede o cliente de apagar — `jobs` (apagar da fila é sabotar o próprio
 * processamento) e `usage_events` (apagar o consumo é apagar a conta a pagar).
 * Afrouxar essas políticas para o caso da exclusão abriria as duas o ano
 * inteiro, para resolver uma operação que acontece uma vez.
 *
 * ## A ordem importa
 *
 * `sessions.patient_id` tem `on delete restrict`: apagar um paciente com
 * consulta gravada é recusado pelo banco. Deixar o `cascade` de
 * `professionals` resolver sozinho depende de qual linha o Postgres visita
 * primeiro — e depender disso é escrever um teste de sorte. A ordem explícita
 * abaixo vai das folhas para a raiz.
 *
 * ## O que sobrevive, e em que estado
 *
 * A trilha de auditoria. `audit_log.professional_id` não tem chave
 * estrangeira, e isso foi desenhado assim: o registro de que uma conta existiu
 * e foi excluída é justamente o que uma auditoria precisa guardar (LGPD Art.
 * 16, I — guarda para cumprimento de obrigação legal).
 *
 * Mas "sobreviver" não é "sobreviver inteira". IP e agente do navegador são
 * dado pessoal de alguém que acabou de pedir para ser esquecido, e nenhuma
 * auditoria futura precisa deles para reconstruir que ações aconteceram e
 * quando. Eles são anulados. O que resta é um UUID sem dono, uma lista de
 * ações e seus horários — o mínimo que uma trilha precisa ser para continuar
 * sendo uma trilha.
 */
export async function excluirConta(me: Professional): Promise<ResultadoDaExclusao> {
  /**
   * O áudio sai primeiro, fora da transação.
   *
   * Arquivo não tem `rollback`: se a transação falhasse depois de apagar, os
   * arquivos já teriam ido. Fazendo antes, o pior caso é ficar sem áudio e com
   * os registros — recuperável pelo suporte. Na ordem inversa, o pior caso
   * seria a conta apagada e o áudio de consulta continuando no disco, que é
   * exatamente o que a exclusão deveria impedir.
   */
  const comAudio = await getDb()
    .select({
      audioPath: sessions.audioPath,
      secondChannelPath: sessions.secondChannelPath,
    })
    .from(sessions)
    .where(
      sql`${sessions.professionalId} = ${me.id} and ${isNotNull(sessions.audioPath)}`,
    );

  let audiosApagados = 0;
  for (const s of comAudio) {
    // Principal e segundo microfone — ver `arquivosDaGravacao`. A varredura por
    // prefixo logo abaixo também os pegaria, mas por acaso de layout.
    //
    // A contagem é só de ÁUDIO: é o que a pessoa lê no comprovante de
    // exclusão, e o arquivo do segundo microfone não é áudio (é a energia dele
    // a cada 5 ms). Contá-lo inflaria o número.
    for (const chave of arquivosDaGravacao(s)) {
      await storage
        .remove(chave)
        .then(() => {
          if (chave === s.audioPath) audiosApagados += 1;
        })
        .catch(() => undefined);
    }
  }

  // Os pedaços de uploads inacabados e a assinatura moram sob o ID do dono.
  for (const chave of await storage.list(me.id).catch(() => [])) {
    await storage.remove(chave).catch(() => undefined);
  }

  const db: Database = getDb();

  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role service_role`);

    const contar = async (tabela: string): Promise<number> => {
      const linhas = await tx.execute(
        sql`select count(*)::int as n from ${sql.raw(tabela)} where professional_id = ${me.id}`,
      );
      const primeira = (linhas as unknown as { n: number }[])[0];
      return primeira?.n ?? 0;
    };

    const pacientes = await contar("patients");
    const consultas = await contar("sessions");
    const documentosContados = await contar("documents");

    await tx
      .delete(transcriptSegments)
      .where(eq(transcriptSegments.professionalId, me.id));
    await tx.delete(documents).where(eq(documents.professionalId, me.id));
    await tx.delete(jobs).where(eq(jobs.professionalId, me.id));
    await tx.delete(usageEvents).where(eq(usageEvents.professionalId, me.id));
    await tx.delete(sessions).where(eq(sessions.professionalId, me.id));
    await tx.delete(patients).where(eq(patients.professionalId, me.id));
    await tx
      .delete(objectiveTemplates)
      .where(eq(objectiveTemplates.professionalId, me.id));

    /**
     * Anonimiza o que a trilha guardava sobre a origem dos acessos. Ver a nota
     * no topo: a trilha continua; o que identificava a pessoa, não.
     */
    await tx
      .update(auditLog)
      .set({ ip: null, userAgent: null })
      .where(eq(auditLog.professionalId, me.id));

    /**
     * A trilha da própria exclusão é escrita AQUI, com a conexão privilegiada,
     * e não por `audit_append()`: a função resolve o dono a partir de
     * `professionals`, e daqui a um comando essa linha não existe mais.
     */
    await tx.insert(auditLog).values({
      actorId: me.authUserId,
      professionalId: me.id,
      action: ACOES.contaExcluida,
      entity: "professionals",
      entityId: me.id,
      metadata: {
        pacientes,
        consultas,
        documentos: documentosContados,
        audiosApagados,
      },
    });

    await tx.delete(professionals).where(eq(professionals.id, me.id));

    return {
      audiosApagados,
      pacientes,
      consultas,
      documentos: documentosContados,
    };
  });
}

/** Registra a exportação na trilha — é um evento de saída de dados. */
export async function auditarExportacao(tx: Tx, dados: DadosExportados): Promise<void> {
  await auditar(tx, {
    acao: ACOES.dadosExportados,
    entidade: "professionals",
    metadados: {
      pacientes: dados.pacientes.length,
      consultas: dados.consultas.length,
      trechos: dados.trechos.length,
      documentos: dados.documentos.length,
    },
  });
}
