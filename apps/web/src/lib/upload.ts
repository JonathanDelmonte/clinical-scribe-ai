import "server-only";

import type { Account } from "@scribe/core";
import { jobs, sessions } from "@scribe/db";
import { eq } from "drizzle-orm";

import type { Professional, Tx } from "./auth";
import { verificarQuota, type Quota } from "./quota";

/**
 * O que acontece quando o áudio de uma sessão termina de chegar.
 *
 * Dois caminhos chegam aqui — o envio direto, de um arquivo escolhido na tela,
 * e o envio em pedaços, da gravação. A regra de quota e o enfileiramento
 * precisam ser **os mesmos nos dois**: duplicar a verificação é criar um
 * caminho em que ela é esquecida, e esse caminho custa dinheiro toda vez que
 * alguém passa por ele.
 */

export interface AudioRecebido {
  readonly key: string;
  readonly durationMs: number | null;
  readonly silenceRemovedMs: number | null;
  readonly speechRegions: unknown;
}

export type ResultadoDoAudio =
  | { readonly ok: true; readonly quota: Quota }
  | { readonly quotaExcedida: true; readonly motivo: string; readonly quota: Quota };

/** ~200 MB. Uma consulta de uma hora em webm/opus fica bem abaixo disso. */
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/**
 * Extensões aceitas.
 *
 * Lista fechada em vez de confiar no content-type: o tipo declarado vem do
 * cliente e não custa nada mentir. A extensão só decide o nome do arquivo em
 * disco — quem realmente decodifica é o ffmpeg dentro do serviço de ASR, que
 * olha o conteúdo.
 */
export const EXTENSOES_ACEITAS = new Set([
  "webm",
  "wav",
  "mp3",
  "m4a",
  "ogg",
  "opus",
  "flac",
  "mp4",
]);

/**
 * Marca o áudio na sessão, confere a quota e enfileira — nesta ordem.
 *
 * O áudio já está gravado quando esta função é chamada, e é deliberado: a
 * consulta já aconteceu, e recusá-la por quota apagaria uma gravação que não
 * existe em outro lugar e não pode ser refeita. O que a quota protege é o
 * custo de processar, não o disco.
 */
export async function registrarAudio(
  tx: Tx,
  me: Professional,
  sessionId: string,
  audio: AudioRecebido,
): Promise<ResultadoDoAudio> {
  const account: Account = {
    role: me.role,
    plan: me.plan,
    preferredEngine: me.preferredEngine,
  };

  const quota = await verificarQuota(
    tx,
    account,
    audio.durationMs === null ? null : audio.durationMs / 60_000,
  );

  const comuns = {
    audioPath: audio.key,
    endedAt: new Date(),
    durationMs: audio.durationMs,
    silenceRemovedMs: audio.silenceRemovedMs,
    speechRegions: audio.speechRegions,
  };

  if (!quota.permitido) {
    await tx
      .update(sessions)
      .set({
        ...comuns,
        status: "failed",
        failureReason:
          `${quota.motivo} A gravação está guardada e será processada ` +
          `quando houver quota — no próximo mês, ou mudando de plano.`,
      })
      .where(eq(sessions.id, sessionId));

    return { quotaExcedida: true, motivo: quota.motivo, quota: quota.quota };
  }

  await tx
    .update(sessions)
    .set({ ...comuns, status: "uploaded", failureReason: null })
    .where(eq(sessions.id, sessionId));

  // Enfileirar por último, e só depois de o áudio estar gravado: um job que
  // roda antes do arquivo existir falha, faz retry com backoff e polui o log
  // com um erro que não é erro nenhum.
  await tx.insert(jobs).values({
    professionalId: me.id,
    sessionId,
    kind: "transcribe",
  });

  return { ok: true, quota: quota.quota };
}
