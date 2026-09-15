/**
 * Contrato de transcrição — o que todo motor precisa entregar.
 *
 * Existe para que trocar `local` por `cloud` seja configuração, não reescrita.
 * O worker conversa só com esta interface; quem implementa é problema da
 * fábrica de provedores.
 *
 * Isto importa mais do que parece: o Marco 1 pode concluir que o fornecedor
 * de nuvem escolhido não presta e que outro é melhor. Com o contrato no meio,
 * essa troca mexe num arquivo. Sem ele, mexe no pipeline inteiro.
 */

import type { Engine } from "./account.js";

/** Um trecho como o motor devolve — antes de virar `TranscriptSegment`. */
export interface RawSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  /** Rótulo cru da diarização: "SPEAKER_00", "SPEAKER_01"… */
  readonly speakerLabel: string;
  /** 0–1, ou `null` quando o motor não informa. */
  readonly confidence: number | null;
}

export interface TranscriptionResult {
  readonly engine: Engine;
  readonly model: string;
  readonly language: string;
  readonly durationMs: number;
  readonly processingMs: number;
  /**
   * Quantas vezes mais rápido que o tempo real.
   *
   * Abaixo de 1,0 significa que processar demora mais do que a consulta durou.
   * É o número que decide se o motor local aguenta o plano grátis — e ele só
   * aparece medindo, não lendo documentação.
   */
  readonly realtimeFactor: number | null;
  /**
   * `false` quando o motor transcreveu mas não separou vozes.
   *
   * Não é falha: transcrição sem diarização ainda serve. Mas a sessão precisa
   * saber, porque sem separação de vozes não dá para identificar papel — e
   * sem papel, a nota não pode ser gerada com segurança.
   */
  readonly diarizationApplied: boolean;
  readonly diarizationError: string | null;
  readonly speakers: readonly string[];
  readonly segments: readonly RawSegment[];
}

export interface TranscriptionInput {
  /**
   * `Uint8Array<ArrayBuffer>` e não `Uint8Array` puro: o tipo padrão inclui
   * buffers compartilhados entre threads (`SharedArrayBuffer`), que `Blob` e
   * `fetch` não aceitam. Áudio vindo do storage é sempre ArrayBuffer comum —
   * dizer isso no tipo evita um cast em cada implementação de motor.
   */
  readonly audio: Uint8Array<ArrayBuffer>;
  readonly filename: string;
  readonly language?: string;
  readonly diarize?: boolean;
}

export interface TranscriptionProvider {
  readonly engine: Engine;
  /** Sobe e responde? Usado no início do job para falhar cedo. */
  healthy(): Promise<boolean>;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

/**
 * Quantos falantes distintos o motor encontrou.
 *
 * Uma consulta com um falante só quase sempre significa que a diarização
 * falhou ou que o microfone só pegou uma pessoa — vale avisar o profissional
 * em vez de gerar uma nota a partir de metade da conversa.
 */
export function speakerCount(result: TranscriptionResult): number {
  return new Set(result.segments.map((s) => s.speakerLabel)).size;
}

/** O resultado é bom o bastante para seguir para identificação de papel? */
export function isUsableForRoleIdentification(
  result: TranscriptionResult,
): { usable: true } | { usable: false; reason: string } {
  if (result.segments.length === 0) {
    return { usable: false, reason: "Nenhuma fala reconhecida no áudio." };
  }
  if (!result.diarizationApplied) {
    return {
      usable: false,
      reason:
        result.diarizationError ??
        "Motor não separou as vozes; não é possível distinguir profissional de paciente.",
    };
  }
  if (speakerCount(result) < 2) {
    return {
      usable: false,
      reason:
        "Apenas um falante detectado — verifique o microfone ou a qualidade do áudio.",
    };
  }
  return { usable: true };
}
