/**
 * O cadastro da voz, pela fila — como as consultas.
 *
 * Antes, o site chamava o motor no meio da requisição; no site publicado não
 * há motor ao alcance, e o cadastro nunca funcionava. Agora o site guarda a
 * amostra e enfileira, e quem processa — o ajudante da pessoa, ou a estação —
 * calcula a impressão vocal, grava os 256 números e apaga a amostra na hora.
 *
 * A amostra NÃO fica guardada além disso: só o vetor. É minimização de dado
 * (LGPD Art. 6º), e é suficiente — o vetor serve para comparar, e a gravação
 * não teria outra utilidade.
 */

import { professionals } from "@scribe/db";
import { professionalFileKey } from "@scribe/storage";
import { eq } from "drizzle-orm";

import type { Executor } from "./fila";

export const TIPO_IMPRESSAO_VOCAL = "voice_embedding";

export const DIMENSOES_DA_IMPRESSAO_VOCAL = 256;

/** O que a tela mostra quando a amostra não serve — e o que a pessoa faz. */
export const VOZ_CURTA =
  "A gravação ficou curta para reconhecer a sua voz. Grave de novo, lendo as frases até o fim.";
export const VOZ_FALHOU = "Não foi possível analisar a gravação. Tente de novo.";

export interface PedidoDeVoz {
  /** Onde a amostra está guardada, até ser processada. */
  readonly chave: string;
  /** O nome do arquivo, cuja extensão diz ao motor o formato. */
  readonly nome: string;
}

/** A chave de uma amostra nova: na pasta do próprio profissional. */
export function chaveDaAmostraDeVoz(
  professionalId: string,
  id: string,
  extensao: string,
): string {
  const ext = /^[a-z0-9]{1,8}$/.test(extensao) ? extensao : "bin";
  return professionalFileKey(professionalId, `amostra-de-voz-${id}.${ext}`);
}

export function lerPedidoDeVoz(
  payload: unknown,
  professionalId: string,
): PedidoDeVoz | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { chave, nome } = payload as Record<string, unknown>;
  if (typeof chave !== "string" || typeof nome !== "string") return null;
  // A amostra precisa ser do dono do job: um payload adulterado não faz
  // ninguém ler o arquivo de outro profissional.
  if (!chave.startsWith(`${professionalId}/perfil/amostra-de-voz-`)) return null;
  if (nome.length === 0 || nome.length > 200) return null;
  return { chave, nome };
}

export function impressaoValida(vetor: unknown): vetor is number[] {
  return (
    Array.isArray(vetor) &&
    vetor.length === DIMENSOES_DA_IMPRESSAO_VOCAL &&
    vetor.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** Grava a impressão vocal no perfil de quem a cadastrou. */
export async function gravarImpressaoVocal(
  db: Executor,
  professionalId: string,
  vetor: readonly number[],
): Promise<void> {
  if (!impressaoValida(vetor)) {
    throw new Error("impressão vocal com formato inesperado");
  }
  await db
    .update(professionals)
    .set({ voiceEmbedding: [...vetor], voiceEnrolledAt: new Date() })
    .where(eq(professionals.id, professionalId));
}
