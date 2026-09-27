/**
 * Motor LOCAL — cliente do serviço Whisper + pyannote em `services/asr-local`.
 *
 * É o motor do plano grátis. O áudio vai para um container nosso e não sai
 * dele: nenhuma chamada externa, nenhuma transferência internacional de dado
 * de saúde, nenhum subprocessador para declarar na política de privacidade.
 */

import type {
  EngineProgress,
  TranscriptionInput,
  TranscriptionProvider,
  TranscriptionResult,
} from "@scribe/core";
import { Agent } from "undici";

/**
 * As chamadas ao motor, sem o corte de 300 s do undici.
 *
 * O motor só responde quando termina, e uma consulta longa passa de cinco
 * minutos de processamento. O `fetch` do Node desiste em 300 s sem receber o
 * cabeçalho da resposta ("fetch failed"), e esse corte vem ANTES do
 * `AbortSignal.timeout` de cada chamada: o sinal só consegue encurtar a
 * espera, nunca alongá-la. Toda transcrição de mais de cinco minutos falhava,
 * em todas as tentativas. Com o corte desligado aqui, quem decide o prazo é o
 * sinal de cada chamada — e só nas chamadas ao motor.
 */
export const semCorteDoUndici = agente({ headersTimeout: 0, bodyTimeout: 0 });

/**
 * Um `Agent` do pacote `undici` no formato que o `fetch` global aceita.
 *
 * O tipo do `fetch` global vem do `undici-types` do @types/node, de outra
 * versão; em execução, o Node 24 traz o undici 7 — o mesmo major do pacote —,
 * e o teste confere que o `fetch` do Node obedece a este agente.
 */
export function agente(
  opcoes: ConstructorParameters<typeof Agent>[0],
): NonNullable<RequestInit["dispatcher"]> {
  return new Agent(opcoes) as unknown as NonNullable<RequestInit["dispatcher"]>;
}

interface LocalResponse {
  model: string;
  language: string;
  duration_ms: number;
  processing_ms: number;
  realtime_factor: number | null;
  diarization_applied: boolean;
  diarization_error: string | null;
  truncated: boolean;
  uncovered_ms: number;
  voice_matching_applied: boolean;
  vocabulary_tokens?: number;
  vocabulary_truncated?: boolean;
  speakers: string[];
  segments: {
    start_ms: number;
    end_ms: number;
    text: string;
    speaker_label: string;
    confidence: number | null;
    voice_similarity?: number | null;
  }[];
}

export class LocalTranscriptionProvider implements TranscriptionProvider {
  readonly engine = "local" as const;

  constructor(
    private readonly baseUrl: string,
    /**
     * Generoso de propósito. Em CPU, uma consulta de 30 minutos pode levar
     * mais de 30 minutos para processar — é a troca que o motor local faz:
     * custo ~zero por lentidão. Um timeout curto aqui transformaria o
     * comportamento esperado num erro.
     */
    private readonly timeoutMs = 45 * 60 * 1000,
  ) {}

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Andamento do trabalho em curso.
   *
   * Nunca lança: é chamada num laço em paralelo com a transcrição, e uma falha
   * aqui não pode derrubar o trabalho de verdade. Sem progresso a tela cai para
   * o indicador simples — irritante, não grave.
   */
  async progress(jobId: string): Promise<EngineProgress | null> {
    try {
      const res = await fetch(`${this.baseUrl}/progress/${jobId}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        phase?: string;
        phase_label?: string;
        percent?: number;
        elapsed_s?: number;
        eta_s?: number | null;
        preview?: string | null;
        audio_s?: number | null;
        transcribed_s?: number | null;
      };
      if (body.phase === undefined || body.phase === "unknown") return null;
      return {
        phase: body.phase,
        phaseLabel: body.phase_label ?? body.phase,
        percent: body.percent ?? 0,
        elapsedSeconds: body.elapsed_s ?? 0,
        etaSeconds: body.eta_s ?? null,
        preview: body.preview ?? null,
        audioSeconds: body.audio_s ?? null,
        transcribedSeconds: body.transcribed_s ?? null,
      };
    } catch {
      return null;
    }
  }

  /** Cadastra a voz do profissional a partir de uma amostra de fala. */
  async enrollVoice(
    audio: Uint8Array<ArrayBuffer>,
    filename: string,
  ): Promise<{ embedding: number[]; durationSeconds: number }> {
    const form = new FormData();
    form.append("file", new Blob([audio]), filename);
    const res = await fetch(`${this.baseUrl}/voice-embedding`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(5 * 60 * 1000),
      dispatcher: semCorteDoUndici,
    });
    if (!res.ok) {
      const corpo = (await res.json().catch(() => null)) as {
        detail?: string;
      } | null;
      throw new Error(corpo?.detail ?? `asr-local respondeu ${res.status}`);
    }
    const body = (await res.json()) as {
      embedding: number[];
      duration_s: number;
    };
    return { embedding: body.embedding, durationSeconds: body.duration_s };
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const form = new FormData();
    // `Blob` e `FormData` são globais no Node desde a 18 (via undici). Não
    // precisa de biblioteca de multipart — e o worker fica sem os tipos de
    // DOM, que ele não deveria ter mesmo.
    form.append("file", new Blob([input.audio]), input.filename);
    if (input.professionalEmbedding != null) {
      form.append(
        "professional_embedding",
        JSON.stringify(input.professionalEmbedding),
      );
    }
    if (input.vocabulary != null && input.vocabulary !== "") {
      form.append("vocabulary", input.vocabulary);
    }

    const params = new URLSearchParams({
      language: input.language ?? "pt",
      diarize: String(input.diarize ?? true),
    });
    if (input.jobId !== undefined) params.set("job", input.jobId);

    // Três vezes a duração, no mínimo o prazo padrão. Em áudio real de
    // consultório o motor roda a ~3,4× o tempo real (ADR-0002), e três horas
    // de consulta — ~53 minutos de processamento — passariam dos 45 fixos.
    const prazoMs = Math.max(this.timeoutMs, 3 * (input.durationMs ?? 0));
    const res = await fetch(`${this.baseUrl}/transcribe?${params}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(prazoMs),
      dispatcher: semCorteDoUndici,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`asr-local respondeu ${res.status}: ${detail.slice(0, 300)}`);
    }

    const body = (await res.json()) as LocalResponse;

    return {
      engine: "local",
      model: body.model,
      language: body.language,
      durationMs: body.duration_ms,
      processingMs: body.processing_ms,
      realtimeFactor: body.realtime_factor,
      diarizationApplied: body.diarization_applied,
      diarizationError: body.diarization_error,
      voiceMatchingApplied: body.voice_matching_applied ?? false,
      vocabularyTokens: body.vocabulary_tokens ?? 0,
      vocabularyTruncated: body.vocabulary_truncated ?? false,
      truncated: body.truncated ?? false,
      uncoveredMs: body.uncovered_ms ?? 0,
      speakers: body.speakers,
      segments: body.segments.map((s) => ({
        startMs: s.start_ms,
        endMs: s.end_ms,
        text: s.text,
        speakerLabel: s.speaker_label,
        confidence: s.confidence,
        voiceSimilarity: s.voice_similarity ?? null,
      })),
    };
  }
}

export interface ResultadoCanais {
  readonly confiavel: boolean;
  readonly motivo: string | null;
  /** [início s, fim s, falante], no tempo do áudio PRINCIPAL. */
  readonly turnos: readonly [number, number, string][];
  readonly alinhamento: {
    readonly deslocamento_s: number;
    readonly deriva_ppm: number;
    readonly qualidade: number;
    readonly janelas: number;
  };
  readonly separacao_db?: number;
  readonly fracao_canal_a?: number;
  /** Fração do áudio da sessão que o segundo microfone também gravou. */
  readonly cobertura?: number;
  readonly segundos: number;
}

/**
 * Pede ao motor a diarização por dois microfones.
 *
 * O segundo microfone vai como ENVELOPE — a energia dele a cada 5 ms, medida
 * no navegador —, nunca como áudio. Ver `canais.py`.
 *
 * Função solta, e não método do provedor: é uma capacidade só do motor local
 * — nenhum fornecedor de nuvem recebe dois canais e devolve quem falou pela
 * energia de cada um. Pendurá-la na interface comum obrigaria todo motor a
 * fingir que sabe fazer isto.
 */
export async function diarizarPorCanais(
  baseUrl: string,
  entrada: {
    principal: Uint8Array<ArrayBuffer>;
    nomePrincipal: string;
    envelope: Uint8Array<ArrayBuffer>;
    regioes: unknown;
    duracaoOriginalMs: number | null;
  },
): Promise<ResultadoCanais> {
  const form = new FormData();
  form.append("principal", new Blob([entrada.principal]), entrada.nomePrincipal);
  form.append("envelope", new Blob([entrada.envelope]), "segundo-microfone.cve");
  if (Array.isArray(entrada.regioes) && entrada.regioes.length > 0) {
    form.append("regioes", JSON.stringify(entrada.regioes));
  }
  if (entrada.duracaoOriginalMs !== null) {
    form.append("duracao_original_ms", String(entrada.duracaoOriginalMs));
  }

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/diarize-channels`, {
    method: "POST",
    body: form,
    // Decodificar o áudio da sessão e correlacionar leva segundos, não
    // minutos — mas uma consulta longa pode passar de um. Dez minutos é
    // folga, não expectativa.
    signal: AbortSignal.timeout(10 * 60 * 1000),
    dispatcher: semCorteDoUndici,
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => "");
    throw new Error(
      `motor respondeu ${res.status} na diarização por canal: ${corpo.slice(0, 300)}`,
    );
  }
  return (await res.json()) as ResultadoCanais;
}

/**
 * Resultado de uma conversão: o arquivo convertido, ou por que não houve.
 *
 * 415: o arquivo não é áudio legível. 413: é áudio, mas longo demais para
 * guardar mesmo na menor taxa aceitável (~8 horas).
 */
export type Convertido =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly duracaoMs: number;
    }
  | { readonly ok: false; readonly status: 413 | 415; readonly motivo: string };

/**
 * Manda um arquivo ao conversor do motor — o ffmpeg dele lê AMR, WMA, ALAC,
 * AIFF, CAF, DSS de ditafone, WAV em ADPCM, e o resto que o navegador recusa.
 *
 * `ok: false` é a resposta 415 ou 413 do motor. Não é falha de
 * infraestrutura — tentar de novo daria o mesmo resultado, então quem chama
 * registra o motivo e para, em vez de deixar a fila repetir.
 */
async function converter(
  baseUrl: string,
  rota: "convert" | "envelope",
  arquivo: Uint8Array<ArrayBuffer>,
  nome: string,
  campos: Record<string, string> = {},
): Promise<Convertido> {
  const form = new FormData();
  form.append("file", new Blob([arquivo]), nome);
  for (const [campo, valor] of Object.entries(campos)) form.append(campo, valor);
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/${rota}`, {
    method: "POST",
    body: form,
    // Decodificar uma consulta longa leva segundos. Dez minutos é folga.
    signal: AbortSignal.timeout(10 * 60 * 1000),
    dispatcher: semCorteDoUndici,
  });
  if (res.status === 415 || res.status === 413) {
    const corpo = (await res.json().catch(() => null)) as { detail?: unknown } | null;
    return {
      ok: false,
      status: res.status,
      motivo:
        typeof corpo?.detail === "string"
          ? corpo.detail
          : "o arquivo não é um áudio que o sistema consiga ler",
    };
  }
  if (!res.ok) {
    const corpo = await res.text().catch(() => "");
    throw new Error(
      `motor respondeu ${res.status} na conversão: ${corpo.slice(0, 300)}`,
    );
  }
  return {
    ok: true,
    bytes: new Uint8Array(await res.arrayBuffer()),
    duracaoMs: Number(res.headers.get("x-duracao-ms") ?? "0"),
  };
}

/**
 * Qualquer áudio → M4A (AAC mono, ~14 MB por hora a 32 kbps): a cópia que fica
 * guardada quando o original não cabe num arquivo só, ou não toca na tela.
 *
 * `maxBytes` é o maior arquivo que o armazenamento aceita. Até três horas a
 * taxa é 32 kbps; acima, o motor a baixa o necessário para caber.
 */
export function converterParaM4a(
  baseUrl: string,
  arquivo: Uint8Array<ArrayBuffer>,
  nome: string,
  maxBytes: number,
): Promise<Convertido> {
  return converter(baseUrl, "convert", arquivo, nome, {
    formato: "m4a",
    max_bytes: String(maxBytes),
  });
}

/**
 * Qualquer áudio → a medida do segundo microfone (formato CVE1), para quando o
 * navegador não conseguiu medir. O motor não guarda o arquivo.
 */
export function medirSegundoMicrofoneNoMotor(
  baseUrl: string,
  arquivo: Uint8Array<ArrayBuffer>,
  nome: string,
): Promise<Convertido> {
  return converter(baseUrl, "envelope", arquivo, nome);
}
