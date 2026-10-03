/**
 * A fila de jobs — consumida pela estação (o worker) e pelos ajudantes, estes
 * pelo site. Ver ADR-0005.
 *
 * Quem pega um job fica registrado em `jobs.helper_id` (nulo para a
 * estação), e só quem pegou renova a concessão, conclui ou registra a falha.
 */

import type { Database } from "@scribe/db";
import { sql } from "drizzle-orm";

/** A conexão do worker, ou uma transação aberta pelo site. */
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface ClaimedJob {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly sessionId: string | null;
  readonly professionalId: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  /** Quem pegou: o ajudante, ou nulo para a estação. */
  readonly helperId: string | null;
}

/**
 * Por quanto tempo um job reivindicado é considerado vivo.
 *
 * Curto de propósito: é o tempo máximo que uma sessão fica pendurada depois de
 * quem a pegou morrer. Jobs longos não são prejudicados porque a concessão é
 * RENOVADA enquanto o trabalho acontece — ver `renewLease`.
 */
const LEASE_SECONDS = 120;
/** Renova bem antes de expirar, para uma renovação perdida não soltar o job. */
export const LEASE_RENEW_MS = 30_000;

/**
 * Os jobs que o ajudante processa: os que precisam do motor de transcrição.
 * Nota e objetivo (modelo de IA) e retenção continuam com a estação.
 */
export const TIPOS_DO_AJUDANTE = ["transcribe", "voice_embedding"] as const;

/**
 * Por quanto tempo um ajudante sem dar sinal ainda conta como ligado. Ele dá
 * sinal a cada 15 segundos: três sinais perdidos, e a estação assume.
 */
export const AJUDANTE_LIGADO_SEGUNDOS = 45;

export type QuemPega =
  | { readonly tipo: "estacao" }
  | {
      readonly tipo: "ajudante";
      readonly helperId: string;
      readonly professionalId: string;
    };

const tiposDoAjudante = sql.join(
  TIPOS_DO_AJUDANTE.map((tipo) => sql`${tipo}`),
  sql`, `,
);

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
 * ## Estação e ajudante
 *
 * O AJUDANTE pega só os jobs do próprio profissional, e só os que precisam do
 * motor. A ESTAÇÃO pega os de todo mundo, MENOS esses mesmos jobs de quem tem
 * ajudante ligado e pronto: enquanto o computador da pessoa responde, as
 * consultas dela são processadas lá. Quando ele para de dar sinal, a estação
 * volta a pegá-las — inclusive um job que o ajudante largou no meio, assim que
 * a concessão dele vence.
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
 * A retomada conta como tentativa, e o `attempts < max_attempts` no `select`
 * é o que impede o laço infinito: um job que MATA o worker nunca chega ao
 * `failJob` — quem morre não registra a própria falha — então sem esse limite
 * ele seria retomado para sempre, derrubando o processo a cada ciclo. Passado
 * o limite, quem o enterra é `reapAbandoned`.
 */
export async function claimJob(
  db: Executor,
  quem: QuemPega = { tipo: "estacao" },
): Promise<ClaimedJob | null> {
  const helperId = quem.tipo === "ajudante" ? quem.helperId : null;
  const filtro =
    quem.tipo === "ajudante"
      ? sql`j.professional_id = ${quem.professionalId}
            and j.kind in (${tiposDoAjudante})`
      : sql`not (
              j.kind in (${tiposDoAjudante})
              and exists (
                select 1
                  from helpers h
                 where h.professional_id = j.professional_id
                   and h.ready
                   and h.last_seen_at > now() - make_interval(secs => ${AJUDANTE_LIGADO_SEGUNDOS})
              )
            )`;

  const rows = await db.execute(sql`
    update jobs
       set status = 'running',
           attempts = attempts + 1,
           run_after = now() + make_interval(secs => ${LEASE_SECONDS}),
           helper_id = ${helperId},
           last_error = case
             when status = 'running'
             then 'Quem processava este job foi interrompido no meio. Retomado automaticamente.'
             else last_error
           end
     where id = (
       select j.id
         from jobs j
        where j.status in ('pending', 'running')
          and j.run_after <= now()
          and (j.status = 'pending' or j.attempts < j.max_attempts)
          and ${filtro}
        order by j.run_after
          for update of j skip locked
        limit 1
     )
    returning id,
              kind,
              payload,
              session_id      as "sessionId",
              professional_id as "professionalId",
              attempts,
              max_attempts    as "maxAttempts",
              helper_id       as "helperId"
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
    helperId: row["helperId"] === null ? null : String(row["helperId"]),
  };
}

/**
 * Enterra os jobs abandonados que não têm mais tentativas.
 *
 * Existe porque a fila tem um ponto cego: quem morre não registra a própria
 * falha. Um job que derruba o worker — memória estourada, processo morto —
 * nunca passa por `failJob`, e por isso nunca vira `failed` sozinho.
 *
 * `claimJob` para de retomá-lo depois do limite de tentativas, o que impede o
 * laço. Mas parar de retomar deixaria o job `running` para sempre, e a sessão
 * pendurada do mesmo jeito. Esta varredura fecha o ciclo: o job vira falha
 * visível, com um motivo que diz o que aconteceu.
 *
 * Devolve quantos enterrou, porque um número diferente de zero aqui merece
 * investigação — significa que algo está matando o worker.
 */
export async function reapAbandoned(db: Executor): Promise<number> {
  const rows = await db.execute(sql`
    update jobs
       set status = 'failed',
           finished_at = now(),
           last_error = 'Quem processava este job parou no meio em todas as ' ||
                        max_attempts || ' tentativas. O processamento foi ' ||
                        'interrompido; os dados já gravados estão preservados.'
     where status = 'running'
       and run_after <= now()
       and attempts >= max_attempts
    returning id
  `);
  return (rows as unknown as unknown[]).length;
}

/**
 * Estende a concessão de um job em andamento.
 *
 * É o que permite a concessão ser curta — dois minutos — sem que um job longo
 * seja roubado no meio. Transcrever uma consulta de trinta minutos leva perto
 * de dez; sem renovação, a concessão teria que cobrir o pior caso, e aí toda
 * sessão órfã ficaria pendurada por esse mesmo tempo antes de ser retomada.
 *
 * Só quem PEGOU o job renova (`helper_id`, ou nulo para a estação), e só
 * enquanto ele está `running`: se outro já retomou este job por concessão
 * vencida, esta renovação não faz nada. Sem isso, um processo lento e meio
 * morto poderia retomar a posse de um trabalho que outro já está refazendo.
 *
 * Devolve se a concessão era mesmo de quem pediu.
 */
export async function renewLease(
  db: Executor,
  jobId: string,
  helperId: string | null = null,
): Promise<boolean> {
  const rows = await db.execute(sql`
    update jobs
       set run_after = now() + make_interval(secs => ${LEASE_SECONDS})
     where id = ${jobId}
       and status = 'running'
       and helper_id is not distinct from ${helperId}::uuid
    returning id
  `);
  return (rows as unknown as unknown[]).length > 0;
}

/** Conclui o job — se ele ainda é de quem pede. Devolve se concluiu. */
export async function completeJob(
  db: Executor,
  jobId: string,
  helperId: string | null = null,
): Promise<boolean> {
  const rows = await db.execute(sql`
    update jobs
       set status = 'done',
           last_error = null,
           finished_at = now()
     where id = ${jobId}
       and status = 'running'
       and helper_id is not distinct from ${helperId}::uuid
    returning id
  `);
  return (rows as unknown as unknown[]).length > 0;
}

/**
 * Uma falha que nenhuma nova tentativa resolve — configuração, não acaso.
 *
 * Lançada por um handler, encerra o job na hora, com a mensagem como motivo.
 * Tentar de novo só adiaria o mesmo erro e daria a impressão de defeito
 * intermitente, quando o que falta é alguém mudar uma configuração.
 */
export class ErroDefinitivo extends Error {
  override readonly name = "ErroDefinitivo";
}

/**
 * Devolve o job à fila com backoff exponencial, ou o marca como falho quando
 * as tentativas acabam — ou na hora, com `definitivo`.
 *
 * O backoff importa mais do que parece: a causa mais comum de falha aqui é
 * rate limit do fornecedor de ASR. Sem espera crescente, o retry vira uma
 * tempestade que prolonga exatamente o bloqueio que causou a falha.
 */
export async function failJob(
  db: Executor,
  job: Pick<ClaimedJob, "id" | "attempts" | "maxAttempts">,
  error: string,
  definitivo = false,
  helperId: string | null = null,
): Promise<{ exhausted: boolean; retryInSeconds: number }> {
  const exhausted = definitivo || job.attempts >= job.maxAttempts;
  const retryInSeconds = Math.min(2 ** job.attempts * 5, 300);

  await db.execute(sql`
    update jobs
       set status = ${exhausted ? "failed" : "pending"},
           last_error = ${error.slice(0, 2000)},
           run_after = now() + make_interval(secs => ${retryInSeconds}),
           finished_at = ${exhausted ? sql`now()` : sql`null`}
     where id = ${job.id}
       and status = 'running'
       and helper_id is not distinct from ${helperId}::uuid
  `);

  return { exhausted, retryInSeconds };
}

/**
 * A estação diz que está viva. O site lê isto para responder "há quem
 * processe agora?" — ver `quemProcessa`.
 */
export async function marcarEstacao(db: Executor, id: string): Promise<void> {
  await db.execute(sql`
    insert into stations (id, last_seen_at) values (${id}, now())
    on conflict (id) do update set last_seen_at = now()
  `);
}

/** Uma estação conta como ligada se deu sinal neste intervalo. */
export const ESTACAO_LIGADA_SEGUNDOS = 90;

/**
 * Há quem processe as consultas deste profissional agora? Um ajudante dele,
 * ligado e pronto, ou uma estação viva.
 *
 * Funciona sob RLS, na conexão do site: `helpers` mostra só os do próprio
 * profissional, e `stations` é legível por todos.
 */
export async function quemProcessa(
  db: Executor,
  professionalId: string,
): Promise<{ readonly ajudante: boolean; readonly estacao: boolean }> {
  const rows = await db.execute(sql`
    select
      exists (
        select 1 from helpers
         where professional_id = ${professionalId}
           and ready
           and last_seen_at > now() - make_interval(secs => ${AJUDANTE_LIGADO_SEGUNDOS})
      ) as ajudante,
      exists (
        select 1 from stations
         where last_seen_at > now() - make_interval(secs => ${ESTACAO_LIGADA_SEGUNDOS})
      ) as estacao
  `);
  const row = (rows as unknown as Record<string, unknown>[])[0] ?? {};
  return { ajudante: row["ajudante"] === true, estacao: row["estacao"] === true };
}
