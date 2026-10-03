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

import { hostname } from "node:os";

import { createServiceClient } from "@scribe/db";
import {
  claimJob,
  completeJob,
  ErroDefinitivo,
  failJob,
  LEASE_RENEW_MS,
  marcarEstacao,
  reapAbandoned,
  renewLease,
  TIPO_IMPRESSAO_VOCAL,
  type ClaimedJob,
} from "@scribe/processamento";
import { createStorageFromEnv } from "@scribe/storage";

import { config, requireDatabaseUrl } from "./config.js";
import { logger } from "./logger.js";
import { makeChannelsHandler } from "./handlers/channels.js";
import { makeNoteHandler } from "./handlers/note.js";
import { makeDeleteAudioHandler, sweepRetention } from "./handlers/retention.js";
import { makeObjectiveHandler } from "./handlers/objective.js";
import { makeTranscribeHandler } from "./handlers/transcribe.js";
import { makeVoiceHandler } from "./handlers/voice.js";
import { criarEscolhaDeLlm, lerChaveDoBanco, resolveLlm } from "./llm/index.js";
import { getProvider } from "./providers/index.js";

const db = createServiceClient(requireDatabaseUrl());
const storage = createStorageFromEnv({
  ...process.env,
  STORAGE_ROOT: config.STORAGE_ROOT,
});

type JobHandler = (job: ClaimedJob) => Promise<void>;

/**
 * O modelo DA INSTALAÇÃO é resolvido uma vez, aqui: chave ausente ou política
 * incompatível são erros de configuração, e descobri-los na partida põe a
 * mensagem na primeira tela de quem rodou `pnpm dev`.
 *
 * Mas quem gera cada documento é decidido POR SESSÃO (`criarEscolhaDeLlm`): o
 * profissional que cadastrou a própria chave usa a dele (ADR-0003), e só quem
 * não cadastrou cai no modelo da instalação.
 */
const llm = resolveLlm();
const escolherLlm = criarEscolhaDeLlm({
  lerChave: lerChaveDoBanco(db),
  instalacao: llm,
  aceita: config.LLM_DATA_POLICY,
});

const handlers: Record<string, JobHandler> = {
  transcribe: makeTranscribeHandler(db, storage, logger),

  // Registrados sempre, mesmo sem modelo na instalação: o profissional pode
  // ter a própria chave. Sem modelo nenhum, o handler encerra o job na hora
  // com o motivo (`ErroDefinitivo`), sem gastar tentativas da fila num
  // problema que nenhuma tentativa resolve.
  generate_note: makeNoteHandler(db, escolherLlm, logger),
  generate_objective: makeObjectiveHandler(db, escolherLlm, logger),

  // Retenção mínima: apaga o áudio após AUDIO_RETENTION_DAYS.
  // Quem enfileira é `sweepRetention`, no laço abaixo.
  delete_audio: makeDeleteAudioHandler(db, storage, logger),

  // Segundo microfone: refaz quem falou pela energia de dois canais. Não
  // depende de LLM — o papel continua sendo decidido pelo conteúdo, que é
  // determinístico.
  diarize_channels: makeChannelsHandler(db, storage, logger),

  // O cadastro da voz, pela fila: de quem não tem ajudante ligado.
  [TIPO_IMPRESSAO_VOCAL]: makeVoiceHandler(db, storage, logger),
};

/**
 * O sinal de vida desta estação, a cada 30 segundos — mas só com o motor de
 * pé: uma estação com o motor fora do ar não processa nada, e dizer ao site
 * que há quem processe seria pedir à pessoa que grave a voz à toa.
 */
const ESTACAO = `estacao:${hostname()}`;
const motorLocal = getProvider("local");
async function darSinal(): Promise<void> {
  if (!(await motorLocal.healthy())) return;
  await marcarEstacao(db, ESTACAO).catch((err: unknown) => {
    logger.debug({ err }, "sinal da estação não gravado");
  });
}
void darSinal();
setInterval(() => void darSinal(), 30_000).unref();

if (llm.blockedReason !== null) {
  logger.warn(
    { llmProvider: llm.provider?.name ?? null },
    `SEM MODELO DE IA NA INSTALAÇÃO — só quem cadastrou a própria chave terá nota

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
    const { exhausted, retryInSeconds } = await failJob(
      db,
      job,
      message,
      error instanceof ErroDefinitivo,
    );
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

        // Só o worker 0 varre: N workers ociosos rodariam a mesma consulta ao
        // mesmo tempo, e a proteção contra duplicar jobs é uma condição de
        // corrida esperando acontecer.
        if (workerId === 0) {
          await sweepRetention(db, config.AUDIO_RETENTION_DAYS, log).catch(
            (err: unknown) => {
              // Varredura de manutenção não derruba o laço: o trabalho de
              // verdade continua, e a próxima passagem tenta de novo.
              log.error({ err }, "falha na varredura de retenção");
            },
          );
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
    retencaoDias: config.AUDIO_RETENTION_DAYS,
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
