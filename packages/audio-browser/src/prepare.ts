/**
 * O que o dispositivo faz com o áudio antes de enviá-lo.
 *
 * Esta é a metade do navegador na arquitetura híbrida: os dois lados
 * trabalhando ao mesmo tempo, cada um na função que consegue fazer melhor.
 * O dispositivo reduz e enxuga; o servidor transcreve e separa as vozes.
 *
 *     48 kHz estéreo, 11 min  ──►  16 kHz mono, só a fala  ──►  upload
 *          ~63 MB                        ~5 MB
 *
 * ## As duas operações, e por que elas não são a mesma coisa
 *
 * **Reamostrar é ganho puro.** O Whisper converte tudo para 16 kHz mono antes
 * de olhar — mandar 48 kHz estéreo é subir seis vezes mais bytes para que o
 * servidor jogue fora cinco sextos. Nada se perde, nenhum tempo se move.
 *
 * **Cortar o silêncio muda o áudio**, e aí mora a decisão difícil. Encurtar
 * desloca todos os tempos seguintes, e o produto inteiro depende de clicar
 * numa frase da nota e ouvir o trecho exato que a sustenta.
 *
 * A saída adotada: **o áudio enxuto É o registro.** Os tempos vivem no tempo
 * enxuto de ponta a ponta, sem conversão em lugar nenhum — que é a única forma
 * de não existir um lugar onde alguém esqueceu de converter. O mapa das
 * regiões vai junto e fica guardado, então "quanto de silêncio foi removido" é
 * uma pergunta respondível, e o tempo original é reconstruível.
 *
 * Silêncio não carrega informação clínica. Mas carrega o ruído da sala, que
 * neste desenho **nunca sai do dispositivo**.
 */

import { detectSpeech } from "./vad";
import { totalMs, type SpeechRegion } from "./regions";

/** O que o Whisper usa internamente. Mandar mais é desperdício. */
export const TAXA_ALVO = 16_000;

export interface PreparedAudio {
  readonly file: File;
  readonly regions: readonly SpeechRegion[];
  readonly originalMs: number;
  readonly trimmedMs: number;
  readonly removedMs: number;
  readonly originalBytes: number;
  readonly bytes: number;
}

export interface PrepareOptions {
  /** Cortar o silêncio, além de reamostrar. */
  readonly trimSilence?: boolean;
  /** Abaixo disto o corte não compensa o risco de recortar fala. */
  readonly minDurationMs?: number;
}

/**
 * Decodifica, reamostra para 16 kHz mono e, opcionalmente, corta o silêncio.
 *
 * Só roda no navegador: depende de `AudioContext`. Quem chama trata a falha
 * mandando o arquivo original — degradar para "mais lento" é sempre melhor que
 * degradar para "não gravou".
 */
export async function prepareForUpload(
  blob: Blob,
  options: PrepareOptions = {},
): Promise<PreparedAudio> {
  const { trimSilence = true, minDurationMs = 5000 } = options;

  const bruto = await blob.arrayBuffer();

  // Decodifica na taxa nativa: `decodeAudioData` de um OfflineAudioContext já
  // reamostra para a taxa do contexto, o que resolve a conversão de graça.
  const ctx = new OfflineAudioContext(1, 1, TAXA_ALVO);
  const decodificado = await ctx.decodeAudioData(bruto);

  const mono = paraMono(decodificado);
  const originalMs = (mono.length / TAXA_ALVO) * 1000;

  const regioes =
    trimSilence && originalMs >= minDurationMs
      ? detectSpeech(mono, TAXA_ALVO)
      : [{ startMs: 0, endMs: originalMs }];

  // Detecção que não encontrou nada é sinal de que ela não entendeu o áudio —
  // microfone estranho, gravação muito baixa. Enviar o áudio inteiro é a
  // degradação certa: mais lento, nunca vazio.
  const efetivas = regioes.length === 0 ? [{ startMs: 0, endMs: originalMs }] : regioes;

  const amostras = trimSilence ? concatenar(mono, efetivas) : mono;
  const wav = paraWav(amostras, TAXA_ALVO);

  return {
    file: new File([wav], "consulta.wav", { type: "audio/wav" }),
    regions: efetivas,
    originalMs: Math.round(originalMs),
    trimmedMs: Math.round(totalMs(efetivas)),
    removedMs: Math.round(originalMs - totalMs(efetivas)),
    originalBytes: blob.size,
    bytes: wav.byteLength,
  };
}

/**
 * Soma os canais.
 *
 * Somar e não descartar um: numa gravação de celular na mesa, cada canal pegou
 * a sala de um ângulo, e jogar um fora joga fora metade do que o microfone
 * captou de quem estava do lado errado.
 */
function paraMono(buffer: AudioBuffer): Float32Array {
  const canais = buffer.numberOfChannels;
  if (canais === 1) return buffer.getChannelData(0).slice();

  const saida = new Float32Array(buffer.length);
  for (let c = 0; c < canais; c++) {
    const dados = buffer.getChannelData(c);
    for (let i = 0; i < saida.length; i++) saida[i] = (saida[i] ?? 0) + (dados[i] ?? 0);
  }
  for (let i = 0; i < saida.length; i++) saida[i] = (saida[i] ?? 0) / canais;
  return saida;
}

function concatenar(
  amostras: Float32Array,
  regioes: readonly SpeechRegion[],
): Float32Array {
  const indice = (ms: number): number =>
    Math.min(amostras.length, Math.max(0, Math.round((ms / 1000) * TAXA_ALVO)));

  const total = regioes.reduce((s, r) => s + (indice(r.endMs) - indice(r.startMs)), 0);
  const saida = new Float32Array(total);
  let escrito = 0;
  for (const r of regioes) {
    const parte = amostras.subarray(indice(r.startMs), indice(r.endMs));
    saida.set(parte, escrito);
    escrito += parte.length;
  }
  return saida;
}

/**
 * WAV PCM 16 bits, montado à mão.
 *
 * Sem biblioteca porque o cabeçalho tem 44 bytes e a alternativa seria uma
 * dependência para escrever 44 bytes. E WAV e não webm porque o servidor
 * decodifica o mesmo arquivo com duas bibliotecas diferentes — ffmpeg para o
 * Whisper, torchaudio para o pyannote — e elas discordam sobre MPEG. WAV não
 * dá margem para discordância: é a amostra, sem compressão, sem interpretação.
 */
function paraWav(amostras: Float32Array, taxa: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + amostras.length * 2);
  const view = new DataView(buffer);

  const texto = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  texto(0, "RIFF");
  view.setUint32(4, 36 + amostras.length * 2, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  view.setUint32(16, 16, true); // tamanho do bloco fmt
  view.setUint16(20, 1, true); // PCM sem compressão
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, taxa, true);
  view.setUint32(28, taxa * 2, true); // bytes por segundo
  view.setUint16(32, 2, true); // alinhamento de bloco
  view.setUint16(34, 16, true); // bits por amostra
  texto(36, "data");
  view.setUint32(40, amostras.length * 2, true);

  let offset = 44;
  for (let i = 0; i < amostras.length; i++) {
    // Satura em vez de dar a volta: uma amostra acima de 1.0 truncada por
    // overflow vira um estalo audível e um pico de energia que confunde a
    // diarização. Saturar só achata o pico.
    const v = Math.max(-1, Math.min(1, amostras[i] ?? 0));
    view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}
