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

import type { Engine } from "./account";

/** Um trecho como o motor devolve — antes de virar `TranscriptSegment`. */
export interface RawSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  /** Rótulo cru da diarização: "SPEAKER_00", "SPEAKER_01"… */
  readonly speakerLabel: string;
  /** 0–1, ou `null` quando o motor não informa. */
  readonly confidence: number | null;
  /**
   * Quanto esta fala soa como a voz cadastrada do profissional, de −1 a 1.
   *
   * `null` quando não há voz cadastrada, ou quando o trecho é curto demais
   * para medir — meio segundo de "sim" não carrega timbre, e uma medida ruim
   * com aparência de medida é pior que nenhuma.
   */
  readonly voiceSimilarity?: number | null;
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

  /**
   * O texto termina bem antes do áudio.
   *
   * Existe porque essa é a falha mais perigosa deste pipeline: o serviço
   * responde com sucesso, devolve texto coerente, e omite o final da consulta
   * — que é justamente onde costuma estar a conduta, a receita e a data de
   * retorno. Sem este sinal, a única forma de perceber seria alguém notar que
   * a prescrição sumiu da nota, provavelmente depois do paciente ir embora.
   */
  /** Havia voz cadastrada e ela foi comparada com os trechos? */
  readonly voiceMatchingApplied: boolean;
  readonly truncated: boolean;
  /** Quantos milissegundos de áudio ficaram sem transcrição no fim. */
  readonly uncoveredMs: number;
  readonly speakers: readonly string[];
  readonly segments: readonly RawSegment[];
}

/**
 * Andamento do processamento, para a tela de espera.
 *
 * É progresso REAL, não relógio: o motor sabe até que segundo do áudio já
 * chegou. Uma barra baseada em tempo decorrido mente quando o áudio é mais
 * longo ou a máquina está ocupada, e mentir sobre espera é pior que não
 * informar.
 */
export interface EngineProgress {
  /** decoding | transcribing | diarizing | assembling | done | failed */
  readonly phase: string;
  /** Texto pronto para a tela, em português. */
  readonly phaseLabel: string;
  readonly percent: number;
  readonly elapsedSeconds: number;
  /** Estimativa de quanto falta. `null` antes de haver base para estimar. */
  readonly etaSeconds: number | null;
  /** Último trecho reconhecido — a prova visível de que algo acontece. */
  readonly preview: string | null;
  readonly audioSeconds: number | null;
  readonly transcribedSeconds: number | null;
}

export interface TranscriptionInput {
  /**
   * Identificador para acompanhar o progresso deste trabalho.
   *
   * Opcional porque nem todo motor sabe reportar andamento — um fornecedor de
   * nuvem devolve tudo de uma vez. Quando ausente, a interface cai para o
   * indicador simples.
   */
  readonly jobId?: string;
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
  /** Impressão vocal do profissional, quando cadastrada. 256 números. */
  readonly professionalEmbedding?: readonly number[] | null;
}

export interface TranscriptionProvider {
  readonly engine: Engine;
  /** Sobe e responde? Usado no início do job para falhar cedo. */
  healthy(): Promise<boolean>;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
  /** Andamento, para motores que sabem reportá-lo. */
  progress?(jobId: string): Promise<EngineProgress | null>;
  /** Cadastra a voz do profissional, para motores que suportam. */
  enrollVoice?(
    audio: Uint8Array<ArrayBuffer>,
    filename: string,
  ): Promise<{ embedding: number[]; durationSeconds: number }>;
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
  if (result.truncated) {
    const seconds = Math.round(result.uncoveredMs / 1000);
    return {
      usable: false,
      reason:
        `Transcrição incompleta: os últimos ${seconds}s do áudio não foram ` +
        `transcritos. Não gere nota a partir de uma consulta cortada — o que ` +
        `falta no fim costuma ser a conduta.`,
    };
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
