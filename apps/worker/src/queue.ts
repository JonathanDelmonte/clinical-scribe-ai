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
 * Por quanto tempo um job reivindicado é considerado vivo.
 *
 * Curto de propósito: é o tempo máximo que uma sessão fica pendurada depois de
 * o worker morrer. Jobs longos não são prejudicados porque a concessão é
 * RENOVADA enquanto o trabalho acontece — ver `renewLease`.
 */
const LEASE_SECONDS = 120;
/** Renova bem antes de expirar, para uma renovação perdida não soltar o job. */
export const LEASE_RENEW_MS = 30_000;

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
 *
 * ## Também recupera job abandonado
 *
 * O desligamento gracioso cobre `SIGTERM`: o worker para de pegar novos e
 * termina o atual. Ele não cobre o processo que simplesmente MORRE — reinício
 * em desenvolvimento, falta de memória, contêiner reagendado, queda de
 * energia. Nesse caso o job fica `running` e nenhum outro worker o pega,
 * porque a reivindicação só olhava `pending`. A sessão fica pendurada para
 * sempre, e é o que acontece em todo deploy com trabalho em voo.
 *
 * A concessão resolve com a coluna que já existe. Para um job `pending`,
 * `run_after` significa "não tente antes disto"; para um `running`, passa a
 * significar "considere abandonado depois disto" — que é a mesma pergunta:
 * *a partir de quando outro worker pode pegar este job?*
 *
 * A retomada conta como tentativa. Isso é deliberado: um job que derruba o
 * worker toda vez que roda esgota as tentativas e vira falha visível, em vez
 * de reiniciar o worker em laço para sempre.
 */
export async function claimJob(db: Database): Promise<ClaimedJob | null> {
  const rows = await db.execute(sql`
    update jobs
       set status = 'running',
           attempts = attempts + 1,
           run_after = now() + make_interval(secs => ${LEASE_SECONDS}),
           last_error = case
             when status = 'running'
             then 'O worker foi interrompido no meio deste job. Retomado automaticamente.'
             else last_error
           end
     where id = (
       select id
         from jobs
        where status in ('pending', 'running')
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

/**
 * Estende a concessão de um job em andamento.
 *
 * É o que permite a concessão ser curta — dois minutos — sem que um job longo
 * seja roubado no meio. Transcrever uma consulta de trinta minutos leva perto
 * de dez; sem renovação, a concessão teria que cobrir o pior caso, e aí toda
 * sessão órfã ficaria pendurada por esse mesmo tempo antes de ser retomada.
 *
 * O `status = 'running'` na cláusula importa: se outro worker já retomou este
 * job por concessão vencida, esta renovação não faz nada. Sem isso, um
 * processo lento e meio morto poderia retomar a posse de um trabalho que outro
 * já está refazendo.
 */
export async function renewLease(db: Database, jobId: string): Promise<void> {
  await db.execute(sql`
    update jobs
       set run_after = now() + make_interval(secs => ${LEASE_SECONDS})
     where id = ${jobId}
       and status = 'running'
  `);
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
