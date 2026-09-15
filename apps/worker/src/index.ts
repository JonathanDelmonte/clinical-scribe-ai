/**
 * Worker de processamento assíncrono.
 *
 * Por que este serviço existe separado da aplicação web: transcrever uma
 * consulta de 30 minutos leva minutos. Isso não cabe numa requisição HTTP nem
 * numa função serverless com timeout. É o único componente que precisa viver
 * fora do Next.js — ver ADR-0001.
 *
 * ESTADO — Marco 0: o laço, a reivindicação de jobs e o desligamento gracioso
 * estão prontos. Os handlers ainda não: eles dependem do fornecedor de ASR que
 * o Marco 1 vai escolher. Adicioná-los antes seria construir contra um
 * fornecedor que talvez não passe no portão de qualidade.
 */

import { createServiceClient } from "@scribe/db";

import { config, requireDatabaseUrl } from "./config.js";
import { logger } from "./logger.js";
import { claimJob, completeJob, failJob, type ClaimedJob } from "./queue.js";

const db = createServiceClient(requireDatabaseUrl());

type JobHandler = (job: ClaimedJob) => Promise<void>;

const handlers: Record<string, JobHandler> = {
  // Marco 2 — chama o fornecedor escolhido no ADR-0002 e grava transcript_segments
  // transcribe: handleTranscribe,
  // Marco 3 — LLM lê a transcrição diarizada e atribui PROFISSIONAL × PACIENTE
  // identify_roles: handleIdentifyRoles,
  // Marco 4 — gera a nota com citações por ID e valida determinísticamente
  // generate_note: handleGenerateNote,
  // Marco 6 — retenção mínima: apaga o áudio após AUDIO_RETENTION_DAYS
  // delete_audio: handleDeleteAudio,
};

let running = true;

async function processOne(): Promise<boolean> {
  const job = await claimJob(db);
  if (job === null) return false;

  // Só IDs no log. Nunca `payload` — ele carrega texto de consulta.
  const log = logger.child({
    jobId: job.id,
    kind: job.kind,
    sessionId: job.sessionId,
    attempt: job.attempts,
  });

  const handler = handlers[job.kind];
  if (handler === undefined) {
    const { exhausted } = await failJob(
      db,
      job,
      `Nenhum handler registrado para "${job.kind}"`,
    );
    log.warn({ exhausted }, "job sem handler");
    return true;
  }

  const startedAt = Date.now();
  try {
    await handler(job);
    await completeJob(db, job.id);
    log.info({ durationMs: Date.now() - startedAt }, "job concluído");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { exhausted, retryInSeconds } = await failJob(db, job, message);
    log.error(
      { exhausted, retryInSeconds, durationMs: Date.now() - startedAt },
      exhausted ? "job falhou em definitivo" : "job falhou, reagendado",
    );
  }
  return true;
}

async function loop(workerId: number): Promise<void> {
  const log = logger.child({ workerId });
  log.debug("laço iniciado");

  while (running) {
    try {
      const didWork = await processOne();
      if (!didWork) {
        await sleep(config.WORKER_POLL_INTERVAL_MS);
      }
    } catch (error) {
      // Falha ao falar com o banco. Espera e tenta de novo — derrubar o worker
      // por uma queda momentânea de rede só transfere o problema para o
      // supervisor de processo.
      log.error({ err: error }, "erro no laço, aguardando antes de retomar");
      await sleep(config.WORKER_POLL_INTERVAL_MS * 5);
    }
  }

  log.debug("laço encerrado");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shutdown(signal: string): void {
  if (!running) return;
  running = false;
  // Não mata o job em andamento: `running = false` para de pegar novos e o
  // atual termina. Interromper no meio deixaria uma sessão em "transcribing"
  // para sempre.
  logger.info({ signal }, "desligando — aguardando job em andamento");
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

logger.info(
  {
    concurrency: config.WORKER_CONCURRENCY,
    asrLocalUrl: config.ASR_LOCAL_URL,
    handlers: Object.keys(handlers),
    milestone: 0,
  },
  "worker iniciado",
);

await Promise.all(Array.from({ length: config.WORKER_CONCURRENCY }, (_, i) => loop(i)));

logger.info("worker encerrado");
process.exit(0);
