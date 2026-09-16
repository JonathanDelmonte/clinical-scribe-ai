/**
 * Whisper pequeno rodando no navegador — o rascunho ao vivo.
 *
 * Em thread separada de propósito, e não por elegância: inferência de rede
 * neural ocupa o processador por centenas de milissegundos seguidos. Na thread
 * da página, cada pedaço transcrito congelaria a interface — inclusive o botão
 * de parar a gravação.
 *
 * ## O que este código NÃO é
 *
 * Não é a transcrição da consulta. O `whisper-tiny` tem cerca de 1% do tamanho
 * do `large-v3` que roda no servidor, não separa vozes e erra bastante em
 * português. Ele existe para mostrar que algo está acontecendo, e para o
 * profissional perceber na hora se o microfone está mudo — não para ser lido
 * como registro.
 *
 * A interface diz isso em letras visíveis. Este comentário existe para que
 * ninguém, daqui a seis meses, resolva "aproveitar" este texto.
 */

import {
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";

/**
 * Candidatos, em ordem.
 *
 * Nomes de modelo no Hugging Face mudam de organização com o tempo, e um nome
 * errado aqui aparece como "o rascunho nunca liga" — uma falha silenciosa numa
 * funcionalidade que já é opcional. Tentar em ordem custa uma requisição
 * perdida e evita isso.
 */
const MODELOS = ["onnx-community/whisper-tiny", "Xenova/whisper-tiny"];

type Entrada =
  | { tipo: "iniciar" }
  | { tipo: "audio"; amostras: Float32Array }
  | { tipo: "encerrar" };

type Saida =
  | { tipo: "carregando"; progresso: number }
  | { tipo: "pronto"; modelo: string; acelerado: boolean }
  | { tipo: "texto"; texto: string }
  | { tipo: "erro"; mensagem: string };

let transcritor: AutomaticSpeechRecognitionPipeline | null = null;
let carregando = false;

/**
 * Fila de um item só.
 *
 * O modelo processa um pedaço por vez. Se outro chegar durante a inferência,
 * o mais recente substitui o que estava esperando: numa consulta, texto atual
 * vale mais que texto completo — e uma fila que cresce acumularia atraso até o
 * rascunho ficar minutos atrás da conversa.
 */
let pendente: Float32Array | null = null;
let ocupado = false;

function responder(msg: Saida): void {
  self.postMessage(msg);
}

async function carregar(): Promise<void> {
  if (transcritor !== null || carregando) return;
  carregando = true;

  for (const modelo of MODELOS) {
    // WebGPU é muito mais rápido, mas ainda não existe em todo navegador.
    // WASM roda em qualquer um — mais devagar, e devagar aqui é aceitável.
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
        return;
      } catch {
        // Modelo ausente, WebGPU indisponível, rede fora. Tenta o próximo.
      }
    }
  }

  carregando = false;
  responder({
    tipo: "erro",
    mensagem: "não foi possível carregar o modelo do rascunho ao vivo",
  });
}

async function processar(): Promise<void> {
  if (ocupado || transcritor === null) return;
  const amostras = pendente;
  if (amostras === null) return;

  pendente = null;
  ocupado = true;

  try {
    const saida = await transcritor(amostras, {
      language: "portuguese",
      task: "transcribe",
      // Sem contexto entre pedaços: no servidor, `condition_on_previous_text`
      // fez o modelo truncar e alucinar "Obrigado." Aqui os pedaços já são
      // independentes por construção, e reintroduzir contexto traria o mesmo
      // defeito de volta.
      chunk_length_s: 30,
      return_timestamps: false,
    });

    const texto = Array.isArray(saida)
      ? saida.map((s) => String(s.text ?? "")).join(" ")
      : String((saida as { text?: unknown }).text ?? "");

    if (texto.trim() !== "") responder({ tipo: "texto", texto: texto.trim() });
  } catch (erro) {
    responder({
      tipo: "erro",
      mensagem: erro instanceof Error ? erro.message : "falha ao transcrever",
    });
  } finally {
    ocupado = false;
    if (pendente !== null) void processar();
  }
}

self.onmessage = (evento: MessageEvent<Entrada>) => {
  const msg = evento.data;

  if (msg.tipo === "iniciar") {
    void carregar();
    return;
  }

  if (msg.tipo === "audio") {
    pendente = msg.amostras;
    void processar();
    return;
  }

  if (msg.tipo === "encerrar") {
    transcritor = null;
    pendente = null;
  }
};
