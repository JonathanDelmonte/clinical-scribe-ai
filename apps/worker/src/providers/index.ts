import type { Engine, TranscriptionProvider } from "@scribe/core";

import { config } from "../config.js";
import { CloudTranscriptionProvider } from "./cloud.js";
import { LocalTranscriptionProvider } from "./local.js";

/**
 * Entrega o provedor de um motor.
 *
 * As instâncias são reaproveitadas: cada provedor mantém conexões e
 * configuração, e recriá-los a cada job desperdiça handshake sem ganho.
 */
const providers: Record<Engine, TranscriptionProvider> = {
  local: new LocalTranscriptionProvider(config.ASR_LOCAL_URL),
  cloud: new CloudTranscriptionProvider(),
};

export function getProvider(engine: Engine): TranscriptionProvider {
  return providers[engine];
}

/**
 * Escolhe o provedor, com queda para o local se o preferido estiver fora.
 *
 * A queda só acontece nessa direção — `cloud` cai para `local`, nunca o
 * contrário. O motivo é financeiro: cair para o local degrada a velocidade,
 * que é recuperável. Cair para a nuvem gastaria dinheiro que o plano grátis
 * não cobre, num momento em que ninguém está olhando.
 */
export async function getAvailableProvider(
  preferred: Engine,
): Promise<{ provider: TranscriptionProvider; fellBack: boolean }> {
  const chosen = providers[preferred];
  if (await chosen.healthy()) {
    return { provider: chosen, fellBack: false };
  }

  if (preferred === "cloud") {
    const local = providers.local;
    if (await local.healthy()) {
      return { provider: local, fellBack: true };
    }
  }

  throw new Error(
    `Nenhum motor de transcrição disponível (preferido: ${preferred}). ` +
      `Verifique se o serviço está no ar: pnpm asr:up`,
  );
}

export { CloudTranscriptionProvider, LocalTranscriptionProvider };
