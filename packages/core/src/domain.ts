/**
 * Tipos do domínio.
 *
 * Este módulo é puro de propósito: nenhum import de banco, rede ou framework.
 * Isso mantém os testes na casa dos milissegundos, que é o que torna viável
 * iterar centenas de vezes em qualidade de prompt (ver Marco 4 do plano).
 */

/**
 * O papel de uma voz na consulta.
 *
 * A documentação (§7) é explícita: NÃO identificamos pessoas ("o João", "a
 * Maria"), apenas papéis. É mais barato, mais robusto e é o que o cliente
 * precisa. Quando há acompanhante, a diarização lida com N falantes e o
 * sistema só precisa saber "isto não é o profissional".
 */
export type SpeakerRole = "professional" | "patient" | "other" | "unknown";

/**
 * Como o papel foi determinado — usado para medir acurácia e para saber quanto
 * o Método A (impressão vocal) está de fato contribuindo. Ver Marco 3.
 *
 * `snake_case` porque estes valores SÃO os do enum `role_source` no Postgres.
 * Uma grafia diferente aqui não é estilo: é um valor que o banco recusa.
 */
export type SpeakerRoleSource = "llm" | "voice_match" | "manual" | "channel";

/**
 * Um trecho de fala atribuído a um falante.
 *
 * `id` é opaco e estável, e essa escolha é deliberada: é o único identificador
 * que o LLM pode citar. Se pedíssemos timestamps, o modelo GERARIA números —
 * plausíveis e errados. IDs de uma lista fechada ele só pode copiar, e qualquer
 * ID inexistente é detectado por validação determinística, sem IA no meio.
 */
export interface TranscriptSegment {
  readonly id: string;
  /** Rótulo cru vindo da diarização, ex.: "SPEAKER_00". */
  readonly speakerLabel: string;
  readonly role: SpeakerRole;
  readonly roleSource: SpeakerRoleSource;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  /** Confiança do ASR, 0–1. `null` quando o fornecedor não informa. */
  readonly confidence: number | null;
}

/**
 * Uma afirmação clínica gerada pela IA, com suas fontes.
 *
 * `sources` nunca pode ser vazio numa afirmação clínica: uma frase sem âncora
 * no áudio é exatamente o tipo de fabricação que a documentação (§11) aponta
 * como risco nº 1 — 62% dos achados inventados passaram despercebidos na
 * revisão porque soavam críveis.
 */
export interface CitedStatement {
  /** Caminho na estrutura da nota, ex.: "subjetivo.queixaPrincipal". */
  readonly path: string;
  readonly text: string;
  /** IDs de `TranscriptSegment`. */
  readonly sources: readonly string[];
}

export type SessionStatus =
  | "draft"
  | "recording"
  | "uploaded"
  | "transcribing"
  | "generating"
  | "ready_for_review"
  | "approved"
  | "failed";

export type DocumentType =
  | "clinical_note"
  | "prescription"
  | "referral"
  | "patient_summary"
  | "custom_objective";

export const SPEAKER_ROLES = [
  "professional",
  "patient",
  "other",
  "unknown",
] as const satisfies readonly SpeakerRole[];
