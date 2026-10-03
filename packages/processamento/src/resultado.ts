/**
 * O que um ajudante devolve, conferido antes de chegar ao banco.
 *
 * O resultado vem de um computador que não é nosso, por uma rede que não é
 * nossa. O formato é o mesmo que o motor dá à estação — mas aqui cada campo é
 * conferido: um resultado malformado vira erro na resposta, e não um trecho
 * estranho no prontuário de alguém.
 */

import type { TranscriptionResult } from "@scribe/core";
import { z } from "zod";

/** Doze horas em milissegundos: muito acima de qualquer consulta real. */
const MAX_MS = 12 * 60 * 60 * 1000;

const segmento = z.object({
  startMs: z.number().int().min(0).max(MAX_MS),
  endMs: z.number().int().min(0).max(MAX_MS),
  text: z.string().max(20_000),
  speakerLabel: z.string().min(1).max(64),
  confidence: z.number().finite().nullable(),
  voiceSimilarity: z.number().min(-1).max(1).nullable().optional(),
});

export const esquemaDoResultado = z.object({
  engine: z.literal("local"),
  model: z.string().min(1).max(100),
  language: z.string().max(16),
  durationMs: z.number().int().min(0).max(MAX_MS),
  processingMs: z.number().min(0),
  realtimeFactor: z.number().finite().nullable(),
  diarizationApplied: z.boolean(),
  diarizationError: z.string().max(2000).nullable(),
  voiceMatchingApplied: z.boolean(),
  vocabularyTokens: z.number().int().min(0).optional(),
  vocabularyTruncated: z.boolean().optional(),
  truncated: z.boolean(),
  uncoveredMs: z.number().min(0).max(MAX_MS),
  speakers: z.array(z.string().min(1).max(64)).max(50),
  segments: z.array(segmento).max(50_000),
});

/** O resultado conferido, ou a primeira coisa errada nele. */
export function lerResultado(
  bruto: unknown,
):
  | { readonly ok: true; readonly resultado: TranscriptionResult }
  | { readonly ok: false; readonly erro: string } {
  const lido = esquemaDoResultado.safeParse(bruto);
  if (!lido.success) {
    const primeiro = lido.error.issues[0];
    return {
      ok: false,
      erro: `resultado inválido em ${primeiro?.path.join(".") || "(raiz)"}: ${primeiro?.message ?? "formato"}`,
    };
  }
  // Campo opcional ausente fica ausente, e não `undefined` — é o que o tipo
  // do resultado (e o `exactOptionalPropertyTypes` do projeto) pede.
  const { vocabularyTokens, vocabularyTruncated, segments, ...resto } = lido.data;
  return {
    ok: true,
    resultado: {
      ...resto,
      segments: segments.map(({ voiceSimilarity, ...s }) =>
        voiceSimilarity === undefined ? s : { ...s, voiceSimilarity },
      ),
      ...(vocabularyTokens === undefined ? {} : { vocabularyTokens }),
      ...(vocabularyTruncated === undefined ? {} : { vocabularyTruncated }),
    },
  };
}
