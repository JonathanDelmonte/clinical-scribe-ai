"use client";

import { SpeechChunker } from "@scribe/audio-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  adiantarRitmo,
  CONFERENCIA_INICIAL,
  conferir,
  DetectorDeVoz,
  duracaoEsperadaMs,
  energiaDoQuadro,
  fraseDoCursor,
  montarRoteiro,
  nivelVisual,
  palavrasLidas,
  passoDoRitmo,
  QUADRO_MS,
  RITMO_INICIAL,
  type Conferencia,
  type Ritmo,
  type Roteiro,
} from "./teleprompter";

export type EstadoDaConferencia =
  | { fase: "parada" }
  | { fase: "carregando"; progresso: number }
  | { fase: "pronta" }
  | { fase: "indisponivel" };

export interface LeituraDeVoz {
  readonly roteiro: Roteiro;
  /** A frase sendo lida. Igual ao número de frases quando a leitura acabou. */
  readonly frase: number;
  /** Quantas palavras da frase atual aparecem como já lidas. */
  readonly lidas: number;
  readonly conferencia: Conferencia;
  /** Trechos que ainda esperam a resposta do modelo. */
  readonly pendentes: number;
  readonly estadoDaConferencia: EstadoDaConferencia;
  /** `false` quando o navegador não deixou acompanhar a voz: o avanço vira manual. */
  readonly acompanhando: boolean;
  iniciar: (stream: MediaStream) => Promise<void>;
  /** Para de ouvir, mas deixa a conferência terminar o que já recebeu. */
  parar: () => void;
  /** Passa para a próxima frase na mão. */
  avancar: () => void;
}

/** Silêncio a partir do qual a fala seguinte começa um trecho novo. */
const PAUSA_ENTRE_TRECHOS_MS = 400;

/**
 * A leitura do cadastro de voz: acompanha a fala e confere cada frase.
 *
 *   microfone ─► worklet ─► quadro de 30 ms ─┬─► ritmo (avanço imediato)
 *                                            └─► corte na pausa ─► Whisper
 *
 * É o mesmo encanamento do rascunho ao vivo (`useLiveDraft`), com um uso
 * diferente para o que sai dele; ver `lib/teleprompter.ts` para as duas
 * velocidades.
 *
 * Como lá, nada aqui pode custar a gravação: a amostra que vira impressão
 * vocal é a do `MediaRecorder`, que roda à parte. Se o worklet falhar, a
 * leitura continua com avanço manual; se o modelo não baixar, continua sem
 * conferência.
 */
export function useLeituraDeVoz(
  frases: readonly string[],
  eventos: {
    /** A leitura passou da última frase. */
    aoTerminar: () => void;
    /** Nível do microfone, de 0 a 1, a cada 30 ms. Não passa pelo React. */
    aoNivel: (nivel: number) => void;
  },
): LeituraDeVoz {
  const roteiro = useMemo(() => montarRoteiro(frases), [frases]);
  const esperados = useMemo(() => frases.map(duracaoEsperadaMs), [frases]);

  const [frase, setFrase] = useState(0);
  const [lidas, setLidas] = useState(0);
  const [conferencia, setConferencia] = useState<Conferencia>(CONFERENCIA_INICIAL);
  const [pendentes, setPendentes] = useState(0);
  const [estadoDaConferencia, setEstadoDaConferencia] = useState<EstadoDaConferencia>({
    fase: "parada",
  });
  const [acompanhando, setAcompanhando] = useState(true);

  // O que o laço de áudio lê e escreve 33 vezes por segundo fica em refs: pôr
  // isso em estado faria o React renderizar a cada quadro.
  const eventosRef = useRef(eventos);
  const ritmoRef = useRef<Ritmo>(RITMO_INICIAL);
  const conferenciaRef = useRef<Conferencia>(CONFERENCIA_INICIAL);
  const ouvindoRef = useRef(false);
  const terminouRef = useRef(false);
  const workerRef = useRef<Worker | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const chunkerRef = useRef<SpeechChunker | null>(null);
  const proximoIdRef = useRef(0);
  const dicasRef = useRef(new Map<number, number>());
  const fraseDoTrechoRef = useRef(0);
  const silencioRef = useRef(Number.POSITIVE_INFINITY);

  useEffect(() => {
    eventosRef.current = eventos;
  });

  const mostrar = useCallback(
    (ritmo: Ritmo) => {
      setFrase(ritmo.frase);
      const texto = frases[ritmo.frase];
      const esperado = esperados[ritmo.frase];
      setLidas(
        texto === undefined || esperado === undefined
          ? 0
          : palavrasLidas(texto, ritmo.vozMs / esperado),
      );

      if (ritmo.frase >= frases.length && !terminouRef.current) {
        terminouRef.current = true;
        eventosRef.current.aoTerminar();
      }
    },
    [frases, esperados],
  );

  const enviarTrecho = useCallback(
    (amostras: Float32Array) => {
      const worker = workerRef.current;
      if (worker === null) return;
      const id = ++proximoIdRef.current;
      dicasRef.current.set(id, roteiro.inicioDaFrase[fraseDoTrechoRef.current] ?? 0);
      setPendentes((n) => n + 1);
      // Transfere o buffer em vez de copiar, como no rascunho ao vivo.
      worker.postMessage({ tipo: "audio", id, amostras }, [amostras.buffer]);
    },
    [roteiro],
  );

  const aoResponder = useCallback(
    (e: MessageEvent<Record<string, unknown>>) => {
      const msg = e.data;
      const tipo = msg["tipo"];

      if (tipo === "carregando") {
        setEstadoDaConferencia({
          fase: "carregando",
          progresso: Number(msg["progresso"]) || 0,
        });
      } else if (tipo === "pronto") {
        setEstadoDaConferencia({ fase: "pronta" });
      } else if (tipo === "erro") {
        setEstadoDaConferencia({ fase: "indisponivel" });
      } else if (tipo === "texto" || tipo === "falhou") {
        const id = Number(msg["id"]);
        const dica = dicasRef.current.get(id);
        // Resposta de uma gravação anterior ("gravar de novo" limpa o mapa):
        // não pertence a esta leitura.
        if (dica === undefined) return;
        dicasRef.current.delete(id);
        setPendentes((n) => Math.max(0, n - 1));
        if (tipo === "falhou") return;

        const nova = conferir(
          roteiro,
          conferenciaRef.current,
          String(msg["texto"] ?? ""),
          dica,
        );
        conferenciaRef.current = nova;
        setConferencia(nova);

        // A conferência viu a leitura mais à frente do que o ritmo supôs (quem
        // lê rápido e quase sem pausa): o teleprompter alcança.
        const alcance = fraseDoCursor(roteiro, nova);
        if (ouvindoRef.current && alcance > ritmoRef.current.frase) {
          ritmoRef.current = adiantarRitmo(ritmoRef.current, alcance);
          mostrar(ritmoRef.current);
        }
      }
    },
    [roteiro, mostrar],
  );

  const desligarAudio = useCallback(() => {
    ouvindoRef.current = false;
    chunkerRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    eventosRef.current.aoNivel(0);
  }, []);

  const pararDeOuvir = useCallback(() => {
    // Fecha o que estava em formação: é a última frase, e ela também merece
    // ser conferida.
    const resto = ouvindoRef.current ? (chunkerRef.current?.flush() ?? null) : null;
    if (resto !== null) enviarTrecho(resto);
    desligarAudio();
  }, [enviarTrecho, desligarAudio]);

  const iniciar = useCallback(
    async (stream: MediaStream) => {
      desligarAudio();

      ritmoRef.current = RITMO_INICIAL;
      conferenciaRef.current = CONFERENCIA_INICIAL;
      terminouRef.current = false;
      dicasRef.current.clear();
      fraseDoTrechoRef.current = 0;
      silencioRef.current = Number.POSITIVE_INFINITY;
      setFrase(0);
      setLidas(0);
      setConferencia(CONFERENCIA_INICIAL);
      setPendentes(0);
      setAcompanhando(true);

      // O worker sobrevive a "gravar de novo": o modelo já carregado não
      // precisa ser carregado outra vez.
      if (workerRef.current === null) {
        try {
          const worker = new Worker(
            new URL("../workers/conferir-voz.ts", import.meta.url),
            {
              type: "module",
            },
          );
          worker.onmessage = aoResponder;
          worker.onerror = () => setEstadoDaConferencia({ fase: "indisponivel" });
          worker.postMessage({ tipo: "iniciar" });
          workerRef.current = worker;
          setEstadoDaConferencia({ fase: "carregando", progresso: 0 });
        } catch {
          setEstadoDaConferencia({ fase: "indisponivel" });
        }
      }

      try {
        // 16 kHz direto na captura: é a taxa do Whisper.
        const ctx = new AudioContext({ sampleRate: 16_000 });
        ctxRef.current = ctx;
        await ctx.audioWorklet.addModule("/audio-tap.js");

        const detector = new DetectorDeVoz();
        // Pausa um pouco mais longa que a do rascunho ao vivo: aqui o trecho
        // ideal é a frase inteira, e cortar em cada vírgula daria ao modelo
        // pedaços pequenos demais para acertar.
        const chunker = new SpeechChunker({
          sampleRate: 16_000,
          offsetFrames: 20,
          maxChunkMs: 12_000,
          minChunkMs: 500,
        });
        chunkerRef.current = chunker;

        const fonte = ctx.createMediaStreamSource(stream);
        const tap = new AudioWorkletNode(ctx, "audio-tap");

        tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
          if (!ouvindoRef.current) return;
          const quadro = e.data;
          const energia = energiaDoQuadro(quadro);
          eventosRef.current.aoNivel(nivelVisual(energia));

          const voz = detector.ouvir(energia);
          // Fala depois de uma pausa começa um trecho novo; guarda em que
          // frase ele começou, para a conferência saber onde procurar.
          if (voz && silencioRef.current >= PAUSA_ENTRE_TRECHOS_MS) {
            fraseDoTrechoRef.current = Math.min(
              ritmoRef.current.frase,
              frases.length - 1,
            );
          }
          silencioRef.current = voz ? 0 : silencioRef.current + QUADRO_MS;

          const atual = ritmoRef.current;
          const esperado = esperados[atual.frase];
          if (esperado !== undefined) {
            const proximo = passoDoRitmo(atual, voz, esperado);
            ritmoRef.current = proximo;
            if (
              proximo.frase !== atual.frase ||
              Math.floor(proximo.vozMs / 90) !== Math.floor(atual.vozMs / 90)
            ) {
              mostrar(proximo);
            }
          }

          const trecho = chunker.push(quadro);
          if (trecho !== null) enviarTrecho(trecho);
        };

        fonte.connect(tap);
        ouvindoRef.current = true;
      } catch {
        // Sem worklet não há como acompanhar a voz nem cortar trechos. A
        // gravação segue; a pessoa passa as frases tocando nelas.
        ouvindoRef.current = false;
        setAcompanhando(false);
      }
    },
    [desligarAudio, aoResponder, enviarTrecho, mostrar, frases, esperados],
  );

  // O worker nasce com o `aoResponder` da primeira gravação; mantém atualizado.
  useEffect(() => {
    if (workerRef.current !== null) workerRef.current.onmessage = aoResponder;
  }, [aoResponder]);

  const avancar = useCallback(() => {
    ritmoRef.current = adiantarRitmo(ritmoRef.current, ritmoRef.current.frase + 1);
    mostrar(ritmoRef.current);
  }, [mostrar]);

  // Sair da tela desliga tudo, inclusive o modelo.
  useEffect(
    () => () => {
      ouvindoRef.current = false;
      void ctxRef.current?.close().catch(() => undefined);
      workerRef.current?.postMessage({ tipo: "encerrar" });
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return {
    roteiro,
    frase,
    lidas,
    conferencia,
    pendentes,
    estadoDaConferencia,
    acompanhando,
    iniciar,
    parar: pararDeOuvir,
    avancar,
  };
}
