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

    const res = await fetch(`${this.baseUrl}/transcribe?${params}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
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
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => "");
    throw new Error(
      `motor respondeu ${res.status} na diarização por canal: ${corpo.slice(0, 300)}`,
    );
  }
  return (await res.json()) as ResultadoCanais;
}
