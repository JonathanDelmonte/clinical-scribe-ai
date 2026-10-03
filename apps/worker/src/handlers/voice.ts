/**
 * Handler do cadastro da voz — a impressão vocal da amostra que a pessoa
 * gravou, gravada no perfil dela; a amostra sai logo depois.
 *
 * É o mesmo trabalho que o ajudante faz no computador da pessoa (ADR-0005). A
 * estação o faz para quem não tem ajudante ligado.
 */

import { type Database } from "@scribe/db";
import { ErroDoMotor, LocalTranscriptionProvider } from "@scribe/motor";
import {
  ErroDefinitivo,
  gravarImpressaoVocal,
  lerPedidoDeVoz,
  VOZ_CURTA,
  VOZ_FALHOU,
  type ClaimedJob,
} from "@scribe/processamento";
import type { AudioStorage } from "@scribe/storage";
import type { Logger } from "pino";

import { config } from "../config.js";

export function makeVoiceHandler(db: Database, storage: AudioStorage, logger: Logger) {
  const motor = new LocalTranscriptionProvider(config.ASR_LOCAL_URL);

  return async function handleVoice(job: ClaimedJob): Promise<void> {
    const log = logger.child({ jobId: job.id });
    const pedido = lerPedidoDeVoz(job.payload, job.professionalId);
    if (pedido === null) {
      throw new ErroDefinitivo("pedido de cadastro de voz ilegível");
    }

    // A amostra é a voz da pessoa: sai assim que deixa de ser necessária —
    // no sucesso, na recusa, e na última tentativa de uma falha.
    const apagarAmostra = () =>
      storage.remove(pedido.chave).catch((erro: unknown) => {
        log.error({ err: erro }, "amostra de voz não apagada");
      });

    let amostra: Uint8Array<ArrayBuffer>;
    try {
      amostra = await storage.get(pedido.chave);
    } catch (erro) {
      if (!(await storage.exists(pedido.chave))) throw new ErroDefinitivo(VOZ_FALHOU);
      throw erro;
    }

    try {
      const { embedding, durationSeconds } = await motor.enrollVoice(
        amostra,
        pedido.nome,
      );
      await gravarImpressaoVocal(db, job.professionalId, embedding);
      log.info({ durationSeconds }, "voz cadastrada");
    } catch (erro) {
      if (erro instanceof ErroDoMotor && erro.status === 400) {
        await apagarAmostra();
        throw new ErroDefinitivo(VOZ_CURTA);
      }
      if (job.attempts >= job.maxAttempts) await apagarAmostra();
      throw erro;
    }
    await apagarAmostra();
  };
}
