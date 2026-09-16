"use client";

import { SpeechChunker } from "@scribe/audio-browser";
import { useCallback, useRef, useState } from "react";

export type EstadoRascunho =
  | { fase: "parado" }
  | { fase: "carregando"; progresso: number }
  | { fase: "ouvindo"; acelerado: boolean }
  | { fase: "indisponivel"; motivo: string };

export interface LiveDraft {
  readonly estado: EstadoRascunho;
  /** Os trechos já reconhecidos, em ordem. */
  readonly trechos: readonly string[];
  iniciar: (stream: MediaStream) => Promise<void>;
  parar: () => void;
}

/**
 * O rascunho ao vivo: texto surgindo durante a consulta.
 *
 *   microfone ─► worklet (thread de áudio) ─► corte na pausa ─► worker (Whisper)
 *
 * Três threads, e cada uma existe por um motivo diferente. O worklet vive na
 * thread de áudio porque é lá que as amostras aparecem. O Whisper vive num
 * worker porque a inferência trava quem a hospeda — e travar a página
 * travaria o botão de parar a gravação. O corte fica no meio, na thread da
 * página, porque é aritmética barata e precisa ver os dois lados.
 *
 * ## Falhar aqui não pode custar a consulta
 *
 * Tudo isto é enfeite: WebGPU pode não existir, o modelo pode não baixar, o
 * `AudioWorklet` pode ser bloqueado. A gravação de verdade é o `MediaRecorder`,
 * que roda em paralelo e não depende de nada disto. Por isso cada passo aqui
 * cai para "indisponível" em vez de lançar — o pior resultado aceitável é o
 * profissional não ver o rascunho, nunca perder o áudio.
 */
export function useLiveDraft(): LiveDraft {
  const [estado, setEstado] = useState<EstadoRascunho>({ fase: "parado" });
  const [trechos, setTrechos] = useState<string[]>([]);

  const workerRef = useRef<Worker | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const chunkerRef = useRef<SpeechChunker | null>(null);

  const parar = useCallback(() => {
    // Fecha o que estiver em formação antes de desligar: a última frase da
    // consulta costuma ser a conduta, e é a que mais se quer ver.
    const resto = chunkerRef.current?.flush() ?? null;
    if (resto !== null && workerRef.current !== null) {
      workerRef.current.postMessage({ tipo: "audio", amostras: resto }, [resto.buffer]);
    }

    workerRef.current?.postMessage({ tipo: "encerrar" });
    workerRef.current?.terminate();
    workerRef.current = null;

    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    chunkerRef.current = null;

    setEstado({ fase: "parado" });
  }, []);

  const iniciar = useCallback(async (stream: MediaStream) => {
    setTrechos([]);

    try {
      const worker = new Worker(
        new URL("../workers/live-transcribe.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<Record<string, unknown>>) => {
        const msg = e.data;
        if (msg["tipo"] === "carregando") {
          setEstado({ fase: "carregando", progresso: Number(msg["progresso"]) || 0 });
        } else if (msg["tipo"] === "pronto") {
          setEstado({ fase: "ouvindo", acelerado: msg["acelerado"] === true });
        } else if (msg["tipo"] === "texto") {
          setTrechos((t) => [...t, String(msg["texto"])]);
        } else if (msg["tipo"] === "erro") {
          setEstado({ fase: "indisponivel", motivo: String(msg["mensagem"]) });
        }
      };

      worker.onerror = () => {
        setEstado({ fase: "indisponivel", motivo: "o rascunho ao vivo não carregou" });
      };

      setEstado({ fase: "carregando", progresso: 0 });
      worker.postMessage({ tipo: "iniciar" });

      // 16 kHz direto na captura: é a taxa que o Whisper usa, e pedir ao
      // navegador já nessa taxa evita reamostrar em JavaScript depois.
      const ctx = new AudioContext({ sampleRate: 16_000 });
      ctxRef.current = ctx;
      await ctx.audioWorklet.addModule("/audio-tap.js");

      const chunker = new SpeechChunker({ sampleRate: 16_000 });
      chunkerRef.current = chunker;

      const fonte = ctx.createMediaStreamSource(stream);
      const tap = new AudioWorkletNode(ctx, "audio-tap");

      tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const pedaco = chunker.push(e.data);
        if (pedaco !== null) {
          // Transfere o buffer em vez de copiar: uma frase de 20 s são 1,3 MB,
          // e copiar isso a cada pausa desperdiça memória sem necessidade.
          worker.postMessage({ tipo: "audio", amostras: pedaco }, [pedaco.buffer]);
        }
      };

      fonte.connect(tap);
      // O worklet não vai para as caixas de som: conectar ao destino faria o
      // profissional ouvir a própria voz com atraso, que é insuportável.
      // Um nó sem saída conectada ainda processa.
    } catch (erro) {
      setEstado({
        fase: "indisponivel",
        motivo:
          erro instanceof Error && erro.message !== ""
            ? erro.message
            : "este navegador não suporta o rascunho ao vivo",
      });
    }
  }, []);

  return { estado, trechos, iniciar, parar };
}
