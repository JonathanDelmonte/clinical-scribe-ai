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
import { createLocalStorage, resolveStorageRoot } from "@scribe/storage";

import { config, requireDatabaseUrl } from "./config.js";
import { logger } from "./logger.js";
import { makeNoteHandler } from "./handlers/note.js";
import { makeTranscribeHandler } from "./handlers/transcribe.js";
import { resolveLlm } from "./llm/index.js";
import {
  claimJob,
  completeJob,
  failJob,
  LEASE_RENEW_MS,
  reapAbandoned,
  renewLease,
  type ClaimedJob,
} from "./queue.js";

const db = createServiceClient(requireDatabaseUrl());
const storage = createLocalStorage(resolveStorageRoot(config.STORAGE_ROOT));

type JobHandler = (job: ClaimedJob) => Promise<void>;

/**
 * O LLM é resolvido UMA vez, aqui, e não dentro do handler.
 *
 * Chave ausente ou política de dados incompatível são erros de configuração:
 * eles não mudam entre um job e outro. Descobri-los na partida coloca a
 * mensagem na primeira tela de quem rodou `pnpm dev`; descobri-los no job
 * coloca a mesma mensagem num log, depois de alguém ter esperado.
 */
const llm = resolveLlm();

const handlers: Record<string, JobHandler> = {
  transcribe: makeTranscribeHandler(db, storage, logger),

  // O handler da nota só é registrado se houver um LLM utilizável. Registrá-lo
  // sempre e falhar dentro dele consumiria as 3 tentativas da fila contra um
  // problema que nenhuma tentativa resolve — e o job acabaria como "falhou em
  // definitivo", que soa como defeito quando é só configuração faltando.
  ...(llm.provider !== null && llm.blockedReason === null
    ? { generate_note: makeNoteHandler(db, llm.provider, logger) }
    : {}),

  // Marco 6 — retenção mínima: apaga o áudio após AUDIO_RETENTION_DAYS
  // delete_audio: handleDeleteAudio,
};

if (llm.blockedReason !== null) {
  logger.warn(
    { llmProvider: llm.provider?.name ?? null },
    `GERAÇÃO DE NOTA INDISPONÍVEL

${llm.blockedReason}
`,
  );
}

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

  // Enquanto o handler trabalha, avisa a fila que este job segue vivo. Sem
  // isso, a concessão venceria no meio de uma transcrição longa e outro worker
  // começaria a refazer o mesmo trabalho.
  const heartbeat = setInterval(() => {
    void renewLease(db, job.id).catch((err: unknown) => {
      // Uma renovação perdida não é fatal: a concessão dura quatro vezes o
      // intervalo, então há três chances antes de o job ser dado como órfão.
      log.debug({ err }, "falha ao renovar a concessão do job");
    });
  }, LEASE_RENEW_MS);
  heartbeat.unref();

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
  } finally {
    clearInterval(heartbeat);
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
        // Só quando a fila está vazia: é varredura de manutenção, e competir
        // com trabalho de verdade por conexão de banco não faz sentido.
        const enterrados = await reapAbandoned(db);
        if (enterrados > 0) {
          log.error({ enterrados }, "jobs abandonados sem tentativas restantes");
        }
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
    storage: storage.kind,
    handlers: Object.keys(handlers),
    llm:
      llm.provider !== null && llm.blockedReason === null
        ? `${llm.provider.name}:${llm.provider.model} (${llm.provider.dataPolicy})`
        : "indisponível",
    milestone: 4,
  },
  "worker iniciado",
);

await Promise.all(Array.from({ length: config.WORKER_CONCURRENCY }, (_, i) => loop(i)));

logger.info("worker encerrado");
process.exit(0);
