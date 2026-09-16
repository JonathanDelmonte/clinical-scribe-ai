import { describe, expect, it } from "vitest";

import { SpeechChunker } from "./chunker";

const SR = 16_000;
const FRAME = 480; // 30 ms

let semente = 7;
function aleatorio(): number {
  semente = (semente * 1664525 + 1013904223) % 4294967296;
  return semente / 4294967296 - 0.5;
}

function quadro(fala: boolean, indice: number): Float32Array {
  const out = new Float32Array(FRAME);
  for (let k = 0; k < FRAME; k++) {
    out[k] = fala
      ? Math.sin((2 * Math.PI * 180 * (indice * FRAME + k)) / SR) * 0.3 +
        aleatorio() * 0.02
      : aleatorio() * 0.004;
  }
  return out;
}

/** Empurra `ms` de áudio e devolve todos os pedaços fechados no caminho. */
function alimentar(
  c: SpeechChunker,
  blocos: { fala: boolean; ms: number }[],
): Float32Array[] {
  const pedacos: Float32Array[] = [];
  let i = 0;
  for (const b of blocos) {
    const n = Math.round(b.ms / 30);
    for (let k = 0; k < n; k++, i++) {
      const p = c.push(quadro(b.fala, i));
      if (p !== null) pedacos.push(p);
    }
  }
  return pedacos;
}

describe("SpeechChunker", () => {
  it("não devolve nada enquanto só há ruído de sala", () => {
    const c = new SpeechChunker();
    expect(alimentar(c, [{ fala: false, ms: 4000 }])).toHaveLength(0);
    expect(c.flush()).toBeNull();
  });

  it("fecha o pedaço quando a fala termina", () => {
    const c = new SpeechChunker();
    const p = alimentar(c, [
      { fala: false, ms: 1000 },
      { fala: true, ms: 2500 },
      { fala: false, ms: 1500 },
    ]);
    expect(p).toHaveLength(1);
    // 2,5s de fala + pré-roll, em amostras
    expect(p[0]!.length).toBeGreaterThan(2.5 * SR);
  });

  it("uma pausa curta não parte a frase em duas", () => {
    const c = new SpeechChunker();
    const p = alimentar(c, [
      { fala: true, ms: 2000 },
      { fala: false, ms: 200 },
      { fala: true, ms: 2000 },
      { fala: false, ms: 1500 },
    ]);
    expect(p).toHaveLength(1);
  });

  it("duas frases separadas viram dois pedaços", () => {
    const c = new SpeechChunker();
    const p = alimentar(c, [
      { fala: true, ms: 2000 },
      { fala: false, ms: 2000 },
      { fala: true, ms: 2000 },
      { fala: false, ms: 2000 },
    ]);
    expect(p).toHaveLength(2);
  });

  // "Obrigado pela atenção" é o que o Whisper inventa quando recebe um trecho
  // curto e sem conteúdo. Não mandar o trecho é mais barato que filtrar depois.
  it("descarta trecho curto demais para transcrever", () => {
    const c = new SpeechChunker();
    const p = alimentar(c, [
      { fala: false, ms: 600 },
      { fala: true, ms: 300 },
      { fala: false, ms: 1500 },
    ]);
    expect(p).toHaveLength(0);
  });

  // Passar de 30s faz o Whisper truncar em silêncio: HTTP feliz, texto
  // coerente, e o fim sumido. Fechar antes é a escolha segura.
  it("fecha sozinho quando a fala não para", () => {
    const c = new SpeechChunker({ maxChunkMs: 3000 });
    const p = alimentar(c, [{ fala: true, ms: 10_000 }]);
    expect(p.length).toBeGreaterThanOrEqual(3);
    for (const pedaco of p) {
      expect(pedaco.length).toBeLessThanOrEqual(3.5 * SR);
    }
  });

  it("flush entrega a fala que ficou em aberto", () => {
    const c = new SpeechChunker();
    alimentar(c, [
      { fala: false, ms: 500 },
      { fala: true, ms: 2000 },
    ]);
    expect(c.flush()).not.toBeNull();
  });

  it("flush duas vezes não devolve o mesmo pedaço de novo", () => {
    const c = new SpeechChunker();
    alimentar(c, [{ fala: true, ms: 2000 }]);
    expect(c.flush()).not.toBeNull();
    expect(c.flush()).toBeNull();
  });

  // O detector só decide depois de acumular energia, então a primeira sílaba
  // já passou. Sem pré-roll, "não tome" chega como "tome".
  it("o pré-roll inclui áudio anterior ao início detectado", () => {
    const comum = new SpeechChunker();
    const sem = new SpeechChunker({ preRollMs: 0 });
    const blocos = [
      { fala: false, ms: 1000 },
      { fala: true, ms: 2000 },
      { fala: false, ms: 1500 },
    ];
    const a = alimentar(comum, blocos)[0]!;
    const b = alimentar(sem, blocos)[0]!;
    expect(a.length).toBeGreaterThan(b.length);
  });
});

describe("acordo sobre o tamanho do quadro", () => {
  // O tamanho vive em dois lugares — aqui e no audio-tap.js, que roda noutro
  // contexto e não pode importar daqui. Divergência não quebra nada: só faz a
  // histerese medir uma duração diferente da pretendida, e o corte sair errado
  // sem aviso. Este teste garante que a divergência vira erro alto.
  it("recusa quadro com tamanho diferente do configurado", () => {
    const c = new SpeechChunker();
    expect(() => c.push(new Float32Array(128))).toThrow(/audio-tap/);
  });

  it("aceita o tamanho que o worklet entrega", () => {
    const c = new SpeechChunker();
    expect(() => c.push(new Float32Array(480))).not.toThrow();
  });
});
