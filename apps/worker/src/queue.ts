import type { Database } from "@scribe/db";
import { sql } from "drizzle-orm";

export interface ClaimedJob {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly sessionId: string | null;
  readonly professionalId: string;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/**
 * Reivindica um job de forma atômica.
 *
 * `FOR UPDATE SKIP LOCKED` é o que permite rodar N workers em paralelo sem
 * coordenação externa: cada um trava a linha que pegou e os outros
 * simplesmente pulam para a próxima, sem bloquear e sem pegar o mesmo job
 * duas vezes.
 *
 * O `select` interno é essencial. Um `update ... limit 1` direto não existe em
 * Postgres, e sem o `skip locked` dois workers esperariam o mesmo lock —
 * transformando paralelismo em fila serial silenciosa.
 */
export async function claimJob(db: Database): Promise<ClaimedJob | null> {
  const rows = await db.execute(sql`
    update jobs
       set status = 'running',
           attempts = attempts + 1
     where id = (
       select id
         from jobs
        where status = 'pending'
          and run_after <= now()
        order by run_after
          for update skip locked
        limit 1
     )
    returning id,
              kind,
              payload,
              session_id     as "sessionId",
              professional_id as "professionalId",
              attempts,
              max_attempts   as "maxAttempts"
  `);

  const row = (rows as unknown as Record<string, unknown>[])[0];
  if (row === undefined) return null;

  return {
    id: String(row["id"]),
    kind: String(row["kind"]),
    payload: row["payload"] ?? null,
    sessionId: row["sessionId"] === null ? null : String(row["sessionId"]),
    professionalId: String(row["professionalId"]),
    attempts: Number(row["attempts"]),
    maxAttempts: Number(row["maxAttempts"]),
  };
}

export async function completeJob(db: Database, jobId: string): Promise<void> {
  await db.execute(sql`
    update jobs
       set status = 'done',
           last_error = null,
           finished_at = now()
     where id = ${jobId}
  `);
}

/**
 * Devolve o job à fila com backoff exponencial, ou o marca como falho quando
 * as tentativas acabam.
 *
 * O backoff importa mais do que parece: a causa mais comum de falha aqui é
 * rate limit do fornecedor de ASR. Sem espera crescente, o retry vira uma
 * tempestade que prolonga exatamente o bloqueio que causou a falha.
 */
export async function failJob(
  db: Database,
  job: ClaimedJob,
  error: string,
): Promise<{ exhausted: boolean; retryInSeconds: number }> {
  const exhausted = job.attempts >= job.maxAttempts;
  const retryInSeconds = Math.min(2 ** job.attempts * 5, 300);

  await db.execute(sql`
    update jobs
       set status = ${exhausted ? "failed" : "pending"},
           last_error = ${error.slice(0, 2000)},
           run_after = now() + make_interval(secs => ${retryInSeconds}),
           finished_at = ${exhausted ? sql`now()` : sql`null`}
     where id = ${job.id}
  `);

  return { exhausted, retryInSeconds };
}
