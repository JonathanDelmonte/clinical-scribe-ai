import { arquivosDaGravacao, type AudioStorage } from "@scribe/storage";
import { auditLog, jobs, sessions, type Database } from "@scribe/db";
import { and, eq, inArray, isNotNull, isNull, notExists, sql } from "drizzle-orm";

import type { Logger } from "pino";

import type { ClaimedJob } from "../queue.js";

/**
 * Retenção mínima: apagar o áudio da consulta depois de `AUDIO_RETENTION_DAYS`.
 *
 * É minimização de dado pessoal (LGPD Art. 6º, III e V) e é também a defesa
 * mais barata que existe — **dado apagado não vaza**. O áudio de uma consulta
 * é o registro mais sensível que este sistema guarda, e o valor dele cai a
 * quase zero depois que a nota foi revisada e aprovada: a partir daí ele serve
 * só para reouvir uma citação, e serve cada vez menos com o tempo.
 *
 * ## Por que uma varredura, e não um job agendado no envio
 *
 * A fila já sabe adiar (`run_after`), então dava para enfileirar a exclusão no
 * momento do upload, com data marcada. Três coisas quebram nesse desenho:
 *
 * 1. **Mudar `AUDIO_RETENTION_DAYS` não afetaria nada** já agendado. Encurtar
 *    a retenção — que é uma decisão de privacidade, tomada justamente quando
 *    se quer efeito imediato — não teria efeito nenhum sobre o que já existe.
 * 2. **O áudio anterior a esta funcionalidade** nunca seria apagado.
 * 3. **Uma sessão ainda em processamento** teria o áudio apagado debaixo do
 *    worker se a retenção fosse curta.
 *
 * A varredura resolve as três pela mesma propriedade: ela olha o estado
 * atual e decide de novo, toda vez. É autocorretiva.
 *
 * ## O que ela NUNCA apaga
 *
 * Áudio de sessão que ainda não terminou de ser processada. Os estados
 * terminais são `ready_for_review`, `approved` e `failed`; qualquer outro
 * significa que o worker ainda pode precisar do arquivo, e apagá-lo ali
 * transformaria uma consulta numa perda permanente.
 */

/** Estados em que o worker não precisa mais do arquivo. */
const TERMINAIS = ["ready_for_review", "approved", "failed"] as const;

/**
 * Enfileira exclusões para o áudio que já passou da retenção.
 *
 * Roda quando a fila está vazia — é manutenção, e competir por conexão de
 * banco com trabalho de verdade não faz sentido. Devolve quantos jobs criou.
 */
export async function sweepRetention(
  db: Database,
  dias: number,
  log: Logger,
  limite = 100,
): Promise<number> {
  if (dias < 0) return 0;

  /**
   * O corte de CADA profissional, quando ele escolheu um.
   *
   * Feito em SQL e não em JavaScript de propósito: trazer todas as sessões
   * para filtrar na aplicação cresce com o número de consultas guardadas, e
   * esta varredura roda a cada ciclo ocioso do worker. O banco já sabe fazer
   * a conta por linha.
   *
   * `coalesce` resolve a precedência numa expressão: escolha do profissional
   * primeiro, padrão do servidor depois.
   */
  const dentroDaRetencao = sql`
    ${sessions.endedAt} < now() - make_interval(
      days => coalesce(
        (select p.audio_retention_days
           from professionals p
          where p.id = ${sessions.professionalId}),
        ${dias}
      )
    )
  `;

  const candidatas = await db
    .select({ id: sessions.id, professionalId: sessions.professionalId })
    .from(sessions)
    .where(
      and(
        isNotNull(sessions.audioPath),
        isNull(sessions.audioDeletedAt),
        inArray(sessions.status, [...TERMINAIS]),
        // `ended_at` e não `created_at`: o relógio da retenção começa quando a
        // consulta acabou, não quando alguém abriu a tela para gravá-la.
        dentroDaRetencao,
        // Sem duplicar o que já está na fila. Um segundo job encontraria o
        // arquivo ausente, falharia três vezes e sujaria o log com um erro
        // que não é erro.
        notExists(
          db
            .select({ um: sql`1` })
            .from(jobs)
            .where(
              and(
                eq(jobs.sessionId, sessions.id),
                eq(jobs.kind, "delete_audio"),
                inArray(jobs.status, ["pending", "running"]),
              ),
            ),
        ),
      ),
    )
    .limit(limite);

  if (candidatas.length === 0) return 0;

  await db.insert(jobs).values(
    candidatas.map((s) => ({
      professionalId: s.professionalId,
      sessionId: s.id,
      kind: "delete_audio",
    })),
  );

  log.info({ agendadas: candidatas.length, dias }, "retenção: exclusões enfileiradas");
  return candidatas.length;
}

/**
 * Apaga o áudio de uma sessão.
 *
 * A ordem — arquivo primeiro, banco depois — é deliberada e não é a intuitiva.
 * Se o banco fosse marcado antes e a exclusão do arquivo falhasse, o sistema
 * passaria a afirmar que o áudio não existe mais enquanto ele continua no
 * disco: a pior das duas inconsistências possíveis, porque é a que mente sobre
 * privacidade. No sentido contrário, uma falha deixa o arquivo apagado e a
 * coluna por preencher — a varredura tenta de novo, e o arquivo já não está lá.
 */
export function makeDeleteAudioHandler(
  db: Database,
  storage: AudioStorage,
  logger: Logger,
): (job: ClaimedJob) => Promise<void> {
  return async (job) => {
    const sessionId = job.sessionId;
    if (sessionId === null) throw new Error("job de retenção sem sessão");

    const log = logger.child({ sessionId });

    const [session] = await db
      .select({
        id: sessions.id,
        professionalId: sessions.professionalId,
        status: sessions.status,
        audioPath: sessions.audioPath,
        secondChannelPath: sessions.secondChannelPath,
        audioDeletedAt: sessions.audioDeletedAt,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (session === undefined) return;
    if (session.audioPath === null || session.audioDeletedAt !== null) return;

    /**
     * A sessão voltou a processar entre o agendamento e agora — um
     * reprocessamento pedido pelo profissional, por exemplo. Sair sem apagar
     * é o certo: a varredura reagenda quando ela chegar a um estado terminal.
     */
    if (!(TERMINAIS as readonly string[]).includes(session.status)) {
      log.debug({ status: session.status }, "retenção adiada: sessão em processamento");
      return;
    }

    // Principal e segundo microfone. Esta rotina roda sozinha, sem ninguém
    // olhando — se esquecesse o segundo arquivo, uma medida da consulta
    // ficaria no disco além do prazo que o profissional escolheu, e nada
    // avisaria.
    for (const chave of arquivosDaGravacao(session)) {
      await storage.remove(chave);
    }

    await db
      .update(sessions)
      .set({ audioDeletedAt: new Date() })
      .where(eq(sessions.id, session.id));

    /**
     * A trilha recebe a exclusão com `actor_id` nulo: quem apagou não foi uma
     * pessoa, foi a política. Essa distinção importa numa auditoria — "o
     * sistema apagou conforme a retenção" e "alguém apagou" são fatos
     * diferentes.
     *
     * Escrito direto, e não por `audit_append()`: aquela função resolve o dono
     * a partir da sessão autenticada, e aqui não existe uma. O worker usa
     * `service_role`, que ignora RLS — é a mesma razão pela qual ele consegue
     * escrever trechos e notas de qualquer profissional.
     */
    await db.insert(auditLog).values({
      actorId: null,
      professionalId: session.professionalId,
      action: "sessao.audio_apagado",
      entity: "sessions",
      entityId: session.id,
      metadata: { motivo: "retencao" },
    });

    log.info("áudio apagado pela política de retenção");
  };
}
