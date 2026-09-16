/**
 * Corta a fala em pedaços, ao vivo, na hora em que a pessoa faz uma pausa.
 *
 * Existe para o rascunho ao vivo: o profissional vê o texto surgindo durante a
 * consulta, em vez de esperar o processamento terminar.
 *
 * ## Por que não transcrever os últimos 30 segundos a cada 5
 *
 * É o caminho óbvio, e produz texto repetido. Janelas que se sobrepõem
 * transcrevem as mesmas palavras várias vezes, e juntar isso exige decidir
 * onde uma termina e a outra começa — sobre um texto que muda a cada passada,
 * porque o Whisper vê contexto diferente em cada janela.
 *
 * Cortar na pausa resolve por construção. A fronteira é natural, cada pedaço é
 * transcrito uma vez só, e o Whisper recebe uma frase inteira em vez de um
 * pedaço arbitrário — que é justamente onde ele alucina.
 *
 * ## O que muda em relação à detecção do arquivo inteiro
 *
 * `detectSpeech` olha a gravação toda e tira os níveis de sala e de voz dela.
 * Ao vivo não existe "toda": só existe o que já passou. Então o limiar sai de
 * uma janela deslizante dos últimos segundos, recalculada a cada quadro.
 */

import { limiarDb } from "./vad";

export interface ChunkerOptions {
  readonly sampleRate?: number;
  readonly frameMs?: number;
  readonly onsetFrames?: number;
  readonly offsetFrames?: number;
  readonly thresholdRatio?: number;
  /** Quadros usados para calibrar o limiar. */
  readonly windowFrames?: number;
  /** Fecha o pedaço mesmo sem pausa, para não passar da janela do Whisper. */
  readonly maxChunkMs?: number;
  /** Pedaço menor que isto não vale uma transcrição. */
  readonly minChunkMs?: number;
  /** Amostras mantidas antes do início detectado. */
  readonly preRollMs?: number;
}

const PADRAO = {
  sampleRate: 16_000,
  frameMs: 30,
  onsetFrames: 3,
  offsetFrames: 15,
  thresholdRatio: 0.3,
  windowFrames: 300,
  // O Whisper enxerga 30 s por passada. Fechar em 20 deixa folga para o
  // pré-roll sem nunca encostar no limite, onde ele trunca em silêncio.
  maxChunkMs: 20_000,
  minChunkMs: 700,
  preRollMs: 300,
} as const;

/**
 * Acumula áudio e devolve um pedaço quando a fala termina.
 *
 * Guarda estado entre chamadas de propósito: a decisão "acabou de falar"
 * depende do que veio antes, e um detector sem memória recortaria sílabas.
 */
export class SpeechChunker {
  private readonly o: Required<ChunkerOptions>;
  private readonly amostrasPorQuadro: number;
  private readonly preRollQuadros: number;
  private readonly maxQuadros: number;
  private readonly minQuadros: number;

  /** Quadros recentes, para o limiar. Só energias, não as amostras. */
  private readonly janela: number[] = [];
  /** Amostras desde o começo do pedaço em formação (ou do pré-roll). */
  private buffer: Float32Array[] = [];
  private quadrosNoBuffer = 0;

  private falando = false;
  private acima = 0;
  private abaixo = 0;
  /**
   * Quadros decorridos desde o início da fala.
   *
   * Separado de `quadrosNoBuffer` porque o buffer carrega o pré-roll antes e o
   * silêncio de fechamento depois. Medir o pedaço pelo buffer faria 300 ms de
   * fala parecerem 960 ms, e o filtro de trecho curto — que existe justamente
   * para não mandar ruído ao Whisper — deixaria passar o que devia barrar.
   */
  private quadrosDeFala = 0;
  private conferido = false;

  constructor(options: ChunkerOptions = {}) {
    this.o = { ...PADRAO, ...options };
    this.amostrasPorQuadro = Math.round((this.o.sampleRate * this.o.frameMs) / 1000);
    this.preRollQuadros = Math.ceil(this.o.preRollMs / this.o.frameMs);
    this.maxQuadros = Math.ceil(this.o.maxChunkMs / this.o.frameMs);
    this.minQuadros = Math.ceil(this.o.minChunkMs / this.o.frameMs);
  }

  /**
   * Entrega um quadro de áudio. Devolve um pedaço quando a fala fechou.
   *
   * O quadro precisa ter exatamente `amostrasPorQuadro` amostras — quem chama
   * é o worklet de áudio, que já entrega nesse tamanho.
   */
  push(quadro: Float32Array): Float32Array | null {
    // Confere uma vez, no primeiro quadro.
    //
    // O tamanho do quadro está escrito em dois lugares: aqui, via `frameMs`, e
    // no `audio-tap.js`, que roda noutro contexto e não pode importar nada
    // daqui. Se os dois divergirem, nada quebra — as contagens de histerese
    // passam a medir uma duração diferente da pretendida, e o corte fica
    // errado em silêncio. Falhar alto na primeira chamada é muito melhor que
    // descobrir isso pelo comportamento.
    if (!this.conferido) {
      this.conferido = true;
      if (quadro.length !== this.amostrasPorQuadro) {
        throw new Error(
          `quadro de ${quadro.length} amostras, esperado ${this.amostrasPorQuadro} ` +
            `(${this.o.frameMs} ms a ${this.o.sampleRate} Hz) — audio-tap.js e ` +
            `SpeechChunker precisam concordar no tamanho do quadro`,
        );
      }
    }

    const energia = rms(quadro);

    this.janela.push(energia);
    if (this.janela.length > this.o.windowFrames) this.janela.shift();

    const limiar = limiarDb(this.janela, this.o.thresholdRatio);
    const alto = 20 * Math.log10(Math.max(energia, 1e-9)) >= limiar;

    this.buffer.push(quadro);
    this.quadrosNoBuffer++;

    if (!this.falando) {
      // Fora da fala, o buffer é só pré-roll: o detector chega tarde, e sem
      // guardar o que veio antes o pedaço começaria na segunda sílaba.
      if (this.quadrosNoBuffer > this.preRollQuadros) {
        this.buffer.shift();
        this.quadrosNoBuffer--;
      }

      this.acima = alto ? this.acima + 1 : 0;
      if (this.acima >= this.o.onsetFrames) {
        this.falando = true;
        this.abaixo = 0;
        this.quadrosDeFala = this.o.onsetFrames;
      }
      return null;
    }

    this.abaixo = alto ? 0 : this.abaixo + 1;
    this.quadrosDeFala++;

    if (this.abaixo >= this.o.offsetFrames) return this.fechar();

    // Frase longa demais. Fechar aqui corta no meio de uma palavra, o que é
    // ruim — e é melhor que estourar a janela do Whisper, onde ele trunca em
    // silêncio e devolve metade do que ouviu.
    if (this.quadrosNoBuffer >= this.maxQuadros) return this.fechar();

    return null;
  }

  /** Fecha o que estiver em formação. Chame ao parar a gravação. */
  flush(): Float32Array | null {
    return this.falando ? this.fechar() : null;
  }

  private fechar(): Float32Array | null {
    const quadros = this.buffer;
    // Desconta o silêncio de fechamento: ele está no buffer, mas não é fala.
    const curto = this.quadrosDeFala - this.abaixo < this.minQuadros;

    this.buffer = [];
    this.quadrosNoBuffer = 0;
    this.quadrosDeFala = 0;
    this.falando = false;
    this.acima = 0;
    this.abaixo = 0;

    // Um "sim" de meio segundo não carrega texto suficiente para o modelo
    // acertar, e transcrever ruído curto é a receita da alucinação — é onde o
    // Whisper inventa "Obrigado pela atenção".
    if (curto) return null;

    const total = quadros.reduce((s, q) => s + q.length, 0);
    const saida = new Float32Array(total);
    let escrito = 0;
    for (const q of quadros) {
      saida.set(q, escrito);
      escrito += q.length;
    }
    return saida;
  }
}

function rms(quadro: Float32Array): number {
  let soma = 0;
  for (let i = 0; i < quadro.length; i++) {
    const v = quadro[i] ?? 0;
    soma += v * v;
  }
  return quadro.length > 0 ? Math.sqrt(soma / quadro.length) : 0;
}
