/**
 * Detecção de fala — onde alguém está falando, e onde é só a sala.
 *
 * Puro: recebe amostras e devolve regiões. Nenhuma API de navegador, o que
 * torna possível testar com sinais sintéticos em milissegundos.
 *
 * ## Por que energia, e não um modelo
 *
 * Um modelo treinado (Silero VAD) é melhor que isto, e é para onde vamos. Mas
 * ele custa um download de ~1 MB antes da primeira gravação, e a troca é uma
 * função só — `detectSpeech` entra e sai pela mesma porta.
 *
 * O que torna a versão por energia utilizável não é o limiar: é o que está em
 * volta dele.
 *
 *   1. **Limiar tirado da faixa dinâmica da própria gravação.** Um limiar
 *      absoluto funciona na sala em que foi calibrado e em nenhuma outra. Aqui
 *      ele fica entre o nível da sala e o nível da voz, medidos na própria
 *      consulta — ver `limiarDb`, que é a parte sutil deste arquivo.
 *   2. **Histerese.** Exigir vários quadros seguidos para ENTRAR em fala e
 *      vários para SAIR impede que uma tosse abra uma região e que uma pausa
 *      no meio da palavra feche uma.
 *
 * Sem esses dois, um detector por energia recorta sílabas e é pior que não ter.
 */

import { mergeRegions, padRegions, type SpeechRegion } from "./regions";

export interface VadOptions {
  /** Tamanho do quadro de análise. 30 ms é o padrão em telefonia. */
  readonly frameMs?: number;
  /** Quadros seguidos acima do limiar para declarar início de fala. */
  readonly onsetFrames?: number;
  /** Quadros seguidos abaixo para declarar fim. Maior que `onset` porque
   *  pausas dentro da fala são comuns e cortes no meio dela são graves. */
  readonly offsetFrames?: number;
  /** Onde colocar o limiar dentro da faixa entre sala e voz. 0 = no nível da
   *  sala, 1 = no nível da voz. */
  readonly thresholdRatio?: number;
  /** Folga antes e depois de cada região. */
  readonly paddingMs?: number;
  /** Pausas menores que isto não separam regiões. */
  readonly maxGapMs?: number;
}

const PADRAO = {
  frameMs: 30,
  onsetFrames: 3,
  offsetFrames: 12,
  thresholdRatio: 0.3,
  paddingMs: 200,
  maxGapMs: 400,
} as const;

/** Energia média de um quadro. */
function rms(samples: Float32Array, inicio: number, fim: number): number {
  let soma = 0;
  for (let i = inicio; i < fim; i++) {
    const v = samples[i] ?? 0;
    soma += v * v;
  }
  const n = fim - inicio;
  return n > 0 ? Math.sqrt(soma / n) : 0;
}

/** Abaixo disto não há voz humana em gravação alguma. */
const SILENCIO_ABSOLUTO_DB = -50;
/** Faixa menor que isto significa gravação uniforme — sem dois níveis. */
const FAIXA_MINIMA_DB = 12;

/**
 * Onde fica a fronteira entre a sala e a voz, em decibéis.
 *
 * ## O erro que esta função existe para não cometer
 *
 * A versão anterior usava um percentil baixo como piso de ruído e multiplicava
 * por um fator. Isso pressupõe que boa parte da gravação é silêncio — e numa
 * consulta real é o contrário: as pessoas falam quase o tempo todo. Com 90% de
 * fala, o percentil 20 cai DENTRO da fala, o limiar vira mais alto que a voz,
 * e o detector devolve zero regiões justamente no caso normal de uso.
 *
 * A correção é não procurar um piso solto e sim os DOIS níveis — sala e voz —
 * e colocar a fronteira entre eles. Decibéis porque a percepção sonora é
 * logarítmica: a distância entre sussurro e fala normal é parecida com a
 * distância entre fala normal e grito, em dB, e não em amplitude.
 *
 * Quando os dois níveis quase coincidem, a gravação é uniforme e não há
 * fronteira a encontrar: ou é tudo fala, ou é tudo sala. Aí a decisão passa a
 * ser absoluta, que é o único critério disponível.
 */
function limiarDb(energias: readonly number[], ratio: number): number {
  if (energias.length === 0) return Number.POSITIVE_INFINITY;

  const dB = energias.map((e) => 20 * Math.log10(Math.max(e, 1e-9)));
  const ordenadas = [...dB].sort((a, b) => a - b);
  const percentil = (q: number): number =>
    ordenadas[Math.min(ordenadas.length - 1, Math.floor(ordenadas.length * q))] ?? -180;

  // 5 e 95 em vez de mínimo e máximo: um estalo do codec produz um quadro
  // digitalmente mudo, e um clique de caneta produz um pico. Os extremos são
  // acidentes; os percentis são os níveis reais.
  const sala = percentil(0.05);
  const voz = percentil(0.95);

  if (voz - sala < FAIXA_MINIMA_DB) {
    // `-Infinity` = tudo passa (gravação inteira é fala).
    // `+Infinity` = nada passa (gravação inteira é sala).
    return voz > SILENCIO_ABSOLUTO_DB
      ? Number.NEGATIVE_INFINITY
      : Number.POSITIVE_INFINITY;
  }
  return sala + (voz - sala) * ratio;
}

export function detectSpeech(
  samples: Float32Array,
  sampleRate: number,
  options: VadOptions = {},
): SpeechRegion[] {
  const o = { ...PADRAO, ...options };
  const porQuadro = Math.max(1, Math.round((sampleRate * o.frameMs) / 1000));
  const quadros = Math.floor(samples.length / porQuadro);
  if (quadros === 0) return [];

  const energias: number[] = [];
  for (let q = 0; q < quadros; q++) {
    energias.push(rms(samples, q * porQuadro, (q + 1) * porQuadro));
  }

  const limiar = limiarDb(energias, o.thresholdRatio);

  const regioes: SpeechRegion[] = [];
  let falando = false;
  let acima = 0;
  let abaixo = 0;
  let inicio = 0;

  for (let q = 0; q < quadros; q++) {
    const alto = 20 * Math.log10(Math.max(energias[q] ?? 0, 1e-9)) >= limiar;

    if (!falando) {
      acima = alto ? acima + 1 : 0;
      if (acima >= o.onsetFrames) {
        falando = true;
        // Volta ao primeiro quadro alto da sequência: a fala começou lá, não
        // no quadro em que a contagem fechou.
        inicio = (q - o.onsetFrames + 1) * o.frameMs;
        abaixo = 0;
      }
    } else {
      abaixo = alto ? 0 : abaixo + 1;
      if (abaixo >= o.offsetFrames) {
        falando = false;
        regioes.push({ startMs: inicio, endMs: (q - o.offsetFrames + 1) * o.frameMs });
        acima = 0;
      }
    }
  }

  if (falando) {
    regioes.push({ startMs: inicio, endMs: quadros * o.frameMs });
  }

  const duracaoMs = (samples.length / sampleRate) * 1000;
  return padRegions(mergeRegions(regioes, o.maxGapMs), o.paddingMs, duracaoMs);
}
