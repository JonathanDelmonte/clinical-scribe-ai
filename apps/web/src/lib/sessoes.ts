import "server-only";

import { auditLog, jobs, sessions, type Database } from "@scribe/db";
import { sessionPartsPrefix } from "@scribe/storage";
import { and, eq, sql } from "drizzle-orm";

import { ACOES, auditar } from "./audit";
import { asCurrentProfessional } from "./auth";
import { getDb } from "./db";
import { storage } from "./storage";

/**
 * Interromper e apagar uma consulta — as duas saídas que faltavam.
 *
 * Toda tela que começa um trabalho caro precisa de uma porta de saída. Sem
 * ela, escolher o arquivo errado significa esperar a transcrição inteira de
 * uma consulta que não interessa, pagando a quota, para só então poder fazer
 * alguma coisa a respeito.
 */

/**
 * Estados em que ainda há trabalho para interromper.
 *
 * `draft` fica de fora de propósito: uma sessão que nunca recebeu áudio não
 * tem processamento acontecendo, e o que ela pede é `apagarSessao` — oferecer
 * "cancelar" ali seria um botão que não faz nada.
 */
const EM_ANDAMENTO: ReadonlySet<string> = new Set([
  "uploaded",
  "transcribing",
  "generating",
]);

export function podeCancelar(status: string): boolean {
  return EM_ANDAMENTO.has(status);
}

/**
 * Estados em que a sessão já virou documentação clínica.
 *
 * Não impede apagar — a decisão é do profissional, que é quem responde pelo
 * prontuário. Serve para a tela avisar antes, e para o registro de auditoria
 * distinguir "joguei fora um upload errado" de "apaguei uma consulta
 * transcrita".
 */
const COM_CONTEUDO_CLINICO: ReadonlySet<string> = new Set([
  "ready_for_review",
  "approved",
]);

export function temConteudoClinico(status: string): boolean {
  return COM_CONTEUDO_CLINICO.has(status);
}

export type ResultadoDeCancelamento =
  | {
      readonly ok: true;
      readonly jobsCancelados: number;
      readonly haviaRodando: boolean;
    }
  | { readonly error: string };

/**
 * Interrompe o processamento de uma consulta.
 *
 * ## O que ela consegue garantir, e o que não
 *
 * Um job que ainda está `pending` some da fila: ninguém o pega, e a promessa
 * é inteira. Um job já `running` é outra história — ele vive num processo
 * separado, com um modelo de transcrição carregado na memória, e não há como
 * uma requisição HTTP matá-lo daqui. O que dá para fazer é marcar o job como
 * encerrado, e é o suficiente para que `finishJob` (que só atualiza
 * `where status = 'running'`) não o reabra.
 *
 * ⚠️ Resta uma janela: se o worker terminar a transcrição que já estava em
 * curso, o handler grava o resultado na sessão e ela reaparece como "pronta
 * para revisão". Fechar isso é uma conferência de uma linha dentro do
 * handler — território da Trilha A. Enquanto não existir, o texto da tela não
 * promete mais do que isto entrega.
 *
 * ## Por que com privilégio
 *
 * A RLS proíbe o cliente de mexer em `jobs`, e proíbe com razão: apagar job
 * da fila é sabotar o próprio processamento, e poder marcá-lo como concluído
 * seria poder pular a transcrição inteira. A exceção aqui é estreita e tem a
 * forma que `excluirConta` documenta — a identidade é resolvida ANTES, sob
 * RLS, e o que atravessa a fronteira são dois identificadores já conferidos.
 */
export async function cancelarProcessamento(
  sessionId: string,
): Promise<ResultadoDeCancelamento | null> {
  // Sob RLS: sessão de outro profissional simplesmente não é encontrada.
  // Quem prova a posse é o banco, não um `where` escrito aqui.
  const alvo = await asCurrentProfessional(async (tx, me) => {
    const [session] = await tx
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (session === undefined) return { error: "sessão não encontrada" } as const;
    if (!podeCancelar(session.status)) {
      return { error: "não há processamento em andamento nesta consulta" } as const;
    }
    return { me, status: session.status } as const;
  });

  if (alvo === null) return null;
  if ("error" in alvo) return { error: alvo.error };

  const { me, status } = alvo;
  const db: Database = getDb();

  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role service_role`);

    const meus = and(eq(jobs.sessionId, sessionId), eq(jobs.professionalId, me.id));

    const rodando = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(meus, eq(jobs.status, "running")));

    const naFila = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(meus, eq(jobs.status, "pending")));

    // O que ainda não começou some da fila; o que já começou é encerrado.
    await tx.delete(jobs).where(and(meus, eq(jobs.status, "pending")));
    await tx
      .update(jobs)
      .set({
        status: "failed",
        lastError: "cancelado pelo profissional",
        finishedAt: new Date(),
      })
      .where(and(meus, eq(jobs.status, "running")));

    /**
     * `failed` e não um estado novo.
     *
     * A tentação é criar `cancelled`, e ele seria mais honesto de ler. O
     * custo é que três lugares da Trilha A decidem por este campo — o tipo
     * em `packages/core`, o rótulo da tela de sessão e, o que importa de
     * verdade, a varredura de retenção, que só apaga áudio de sessão em
     * estado terminal. Um estado que ela não conhece seria áudio de consulta
     * guardado para sempre, contrariando a política de privacidade por causa
     * de um rótulo.
     *
     * `failed` já significa exatamente o que esta sessão passa a ser: parada,
     * com o áudio preservado, e pronta para `POST /processar` se a pessoa
     * mudar de ideia. O motivo escrito conta o resto.
     */
    await tx
      .update(sessions)
      .set({
        status: "failed",
        failureReason:
          "Processamento cancelado por você. A gravação continua guardada — " +
          "dá para processar de novo, ou apagar a consulta.",
        progressPercent: null,
        progressPhase: null,
        progressEtaSeconds: null,
        progressPreview: null,
      })
      .where(and(eq(sessions.id, sessionId), eq(sessions.professionalId, me.id)));

    /**
     * A trilha é escrita direto, e não por `audit_append()`: a função resolve
     * o dono a partir da sessão do banco, e aqui o papel é `service_role`.
     * Ver a mesma decisão em `excluirConta`.
     */
    await tx.insert(auditLog).values({
      actorId: me.authUserId,
      professionalId: me.id,
      action: ACOES.sessaoCancelada,
      entity: "sessions",
      entityId: sessionId,
      metadata: {
        statusAnterior: status,
        jobsNaFila: naFila.length,
        jobsRodando: rodando.length,
      },
    });

    return {
      ok: true,
      jobsCancelados: naFila.length + rodando.length,
      haviaRodando: rodando.length > 0,
    } as const;
  });
}

export type ResultadoDaExclusaoDeSessao =
  | { readonly ok: true; readonly audioApagado: boolean; readonly pedacos: number }
  | { readonly error: string };

/**
 * Apaga a consulta inteira — registros e arquivos.
 *
 * ## O banco resolve quase tudo sozinho
 *
 * As chaves estrangeiras já dizem o que fazer, e dizem certo:
 *
 * ```
 *   transcript_segments  →  cascade     a transcrição vai junto
 *   documents            →  cascade     a nota vai junto
 *   jobs                 →  cascade     some da fila
 *   usage_events         →  set null    FICA, sem a consulta
 * ```
 *
 * O `set null` do consumo é a linha que impede o buraco óbvio: se apagar a
 * consulta apagasse os minutos gastos nela, apagar consultas seria o jeito de
 * zerar a quota do mês. O gasto aconteceu; o que some é a que consulta ele
 * pertencia.
 *
 * ## Arquivo antes de linha
 *
 * Arquivo não tem `rollback`. Apagando primeiro, o pior caso é uma linha
 * apontando para um áudio que não existe mais — visível, e resolvido
 * tentando de novo. Na ordem inversa, o pior caso seria a consulta sumir da
 * tela com o áudio continuando no disco: exatamente o que apagar deveria
 * impedir, e invisível para quem pediu.
 */
export async function apagarSessao(
  sessionId: string,
  /** `false` recusa quando a consulta tem gravação — a rede de segurança de
   *  quem só quer descartar um rascunho. */
  confirmado: boolean,
): Promise<ResultadoDaExclusaoDeSessao | null> {
  const alvo = await asCurrentProfessional(async (tx, me) => {
    const [session] = await tx
      .select({
        id: sessions.id,
        status: sessions.status,
        audioPath: sessions.audioPath,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (session === undefined) return { error: "sessão não encontrada" } as const;
    if (session.audioPath !== null && !confirmado) {
      return {
        error: "esta sessão tem gravação e não pode ser descartada",
      } as const;
    }
    return { me, session } as const;
  });

  if (alvo === null) return null;
  if ("error" in alvo) return { error: alvo.error };

  const { me, session } = alvo;

  let audioApagado = false;
  if (session.audioPath !== null) {
    audioApagado = await storage
      .remove(session.audioPath)
      .then(() => true)
      .catch(() => false);
  }

  // Pedaços de um envio que nunca foi montado. Sem isto, cancelar no meio de
  // um upload e apagar em seguida deixaria a consulta inteira no disco, em
  // fatias — a pior forma possível de um áudio sobreviver a um "apagar".
  const pedacos = await storage
    .list(sessionPartsPrefix(me.id, sessionId))
    .catch(() => []);
  for (const chave of pedacos) {
    await storage.remove(chave).catch(() => undefined);
  }

  const resultado = await asCurrentProfessional(async (tx) => {
    /**
     * A trilha vem ANTES do `delete`, e a ordem não é estética: `audit_append`
     * grava o `entity_id` como um UUID solto, sem chave estrangeira, mas a
     * transação inteira precisa existir para valer. Registrar primeiro
     * garante que uma exclusão bem-sucedida nunca fica sem registro.
     */
    await auditar(tx, {
      acao: ACOES.sessaoApagada,
      entidade: "sessions",
      entidadeId: sessionId,
      metadados: {
        status: session.status,
        tinhaAudio: session.audioPath !== null,
        audioApagado,
        pedacos: pedacos.length,
        clinica: temConteudoClinico(session.status),
      },
    });

    await tx.delete(sessions).where(eq(sessions.id, sessionId));
    return { ok: true, audioApagado, pedacos: pedacos.length } as const;
  });

  return resultado ?? null;
}
