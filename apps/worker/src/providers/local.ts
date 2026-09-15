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
  speakers: string[];
  segments: {
    start_ms: number;
    end_ms: number;
    text: string;
    speaker_label: string;
    confidence: number | null;
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

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const form = new FormData();
    // `Blob` e `FormData` são globais no Node desde a 18 (via undici). Não
    // precisa de biblioteca de multipart — e o worker fica sem os tipos de
    // DOM, que ele não deveria ter mesmo.
    form.append("file", new Blob([input.audio]), input.filename);

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
      truncated: body.truncated ?? false,
      uncoveredMs: body.uncovered_ms ?? 0,
      speakers: body.speakers,
      segments: body.segments.map((s) => ({
        startMs: s.start_ms,
        endMs: s.end_ms,
        text: s.text,
        speakerLabel: s.speaker_label,
        confidence: s.confidence,
      })),
    };
  }
}
