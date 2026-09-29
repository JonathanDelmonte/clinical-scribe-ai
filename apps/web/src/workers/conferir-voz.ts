/**
 * A conferência do cadastro de voz: o Whisper do navegador ouvindo cada frase.
 *
 * Irmão do `live-transcribe.ts`, com duas diferenças que vêm do propósito:
 *
 * - **Modelo maior.** O rascunho da consulta usa o `whisper-tiny` porque
 *   precisa acompanhar uma conversa de meia hora. Aqui são trinta segundos de
 *   leitura, e o que importa é acertar: o `whisper-base` erra bem menos em
 *   português, ao custo de um download maior (fica no cache do navegador
 *   depois da primeira vez) e de um pouco de atraso por frase.
 * - **Fila inteira, em ordem.** O rascunho descarta o trecho que esperava
 *   quando chega um mais novo, porque na consulta texto atual vale mais que
 *   texto completo. Aqui cada frase precisa da sua resposta, mesmo que chegue
 *   depois de a leitura acabar.
 *
 * Nada daqui decide o cadastro. A impressão vocal sai da gravação inteira, no
 * servidor. Este worker só diz à pessoa, frase a frase, que o microfone a
 * ouviu, e erra às vezes; a tela avisa disso.
 */

import {
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";

/**
 * Candidatos, do mais preciso ao mais leve.
 *
 * Os dois nomes de cada tamanho existem porque os modelos mudam de
 * organização no Hugging Face com o tempo (ver `live-transcribe.ts`). O tiny
 * fica no fim da lista: conferência imprecisa ainda é melhor que nenhuma.
 */
const MODELOS = [
  "onnx-community/whisper-base",
  "Xenova/whisper-base",
  "onnx-community/whisper-tiny",
  "Xenova/whisper-tiny",
];

type Entrada =
  | { tipo: "iniciar" }
  | { tipo: "audio"; id: number; amostras: Float32Array }
  | { tipo: "encerrar" };

type Saida =
  | { tipo: "carregando"; progresso: number }
  | { tipo: "pronto"; modelo: string; acelerado: boolean }
  | { tipo: "texto"; id: number; texto: string }
  | { tipo: "falhou"; id: number }
  | { tipo: "erro"; mensagem: string };

let transcritor: AutomaticSpeechRecognitionPipeline | null = null;
let carregando = false;
let indisponivel = false;

const fila: { id: number; amostras: Float32Array }[] = [];
let ocupado = false;

function responder(msg: Saida): void {
  self.postMessage(msg);
}

async function carregar(): Promise<void> {
  if (transcritor !== null || carregando) return;
  carregando = true;

  for (const modelo of MODELOS) {
    for (const device of ["webgpu", "wasm"] as const) {
      try {
        transcritor = (await pipeline("automatic-speech-recognition", modelo, {
          device,
          dtype: "q8",
          progress_callback: (p: unknown) => {
            const progresso =
              typeof p === "object" && p !== null && "progress" in p
                ? Number((p as { progress: unknown }).progress)
                : 0;
            if (Number.isFinite(progresso)) {
              responder({ tipo: "carregando", progresso });
            }
          },
        })) as AutomaticSpeechRecognitionPipeline;

        carregando = false;
        responder({ tipo: "pronto", modelo, acelerado: device === "webgpu" });
        void processar();
        return;
      } catch {
        // Modelo ausente, WebGPU indisponível, rede fora. Tenta o próximo.
      }
    }
  }

  carregando = false;
  indisponivel = true;
  // Quem esperava na fila não vai ter resposta: devolve cada um como falho,
  // para a tela não ficar "conferindo" para sempre.
  for (const item of fila.splice(0)) responder({ tipo: "falhou", id: item.id });
  responder({ tipo: "erro", mensagem: "não foi possível carregar a conferência" });
}

async function processar(): Promise<void> {
  if (ocupado || transcritor === null) return;
  const item = fila.shift();
  if (item === undefined) return;

  ocupado = true;
  try {
    const saida = await transcritor(item.amostras, {
      language: "portuguese",
      task: "transcribe",
      chunk_length_s: 30,
      return_timestamps: false,
    });

    const texto = Array.isArray(saida)
      ? saida.map((s) => String(s.text ?? "")).join(" ")
      : String((saida as { text?: unknown }).text ?? "");

    responder({ tipo: "texto", id: item.id, texto: texto.trim() });
  } catch {
    responder({ tipo: "falhou", id: item.id });
  } finally {
    ocupado = false;
    if (fila.length > 0) void processar();
  }
}

self.onmessage = (evento: MessageEvent<Entrada>) => {
  const msg = evento.data;

  if (msg.tipo === "iniciar") {
    void carregar();
    return;
  }

  if (msg.tipo === "audio") {
    if (indisponivel) {
      responder({ tipo: "falhou", id: msg.id });
      return;
    }
    fila.push({ id: msg.id, amostras: msg.amostras });
    void processar();
    return;
  }

  if (msg.tipo === "encerrar") {
    transcritor = null;
    fila.length = 0;
  }
};
