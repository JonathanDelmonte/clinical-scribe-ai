import { describe, expect, it } from "vitest";

import {
  mergeRegions,
  padRegions,
  toOriginalMs,
  totalMs,
  toTrimmedMs,
  type SpeechRegion,
} from "./regions";
import { detectSpeech } from "./vad";

const SR = 16_000;

/**
 * Monta um sinal com trechos de "fala" e de "sala".
 *
 * Fala é uma senoide com ruído; sala é ruído fraco. Não precisa soar como voz
 * — o detector decide por energia, então o que importa é a razão entre as
 * duas. Sintético e determinístico vale mais que uma gravação real aqui:
 * a gente sabe exatamente onde a fala começa.
 */
function sinal(blocos: { fala: boolean; ms: number }[]): Float32Array {
  const total = blocos.reduce((s, b) => s + Math.round((SR * b.ms) / 1000), 0);
  const out = new Float32Array(total);
  let i = 0;
  let semente = 42;
  const aleatorio = () => {
    semente = (semente * 1664525 + 1013904223) % 4294967296;
    return semente / 4294967296 - 0.5;
  };

  for (const b of blocos) {
    const n = Math.round((SR * b.ms) / 1000);
    for (let k = 0; k < n; k++, i++) {
      out[i] = b.fala
        ? Math.sin((2 * Math.PI * 180 * k) / SR) * 0.3 + aleatorio() * 0.02
        : aleatorio() * 0.004;
    }
  }
  return out;
}

describe("detectSpeech", () => {
  it("não encontra fala em áudio só com ruído de sala", () => {
    expect(detectSpeech(sinal([{ fala: false, ms: 3000 }]), SR)).toEqual([]);
  });

  it("encontra a fala no meio do silêncio", () => {
    const r = detectSpeech(
      sinal([
        { fala: false, ms: 1000 },
        { fala: true, ms: 2000 },
        { fala: false, ms: 1000 },
      ]),
      SR,
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.startMs).toBeGreaterThan(400);
    expect(r[0]!.startMs).toBeLessThan(1100);
    expect(r[0]!.endMs).toBeGreaterThan(2800);
  });

  it("separa duas falas com uma pausa longa entre elas", () => {
    const r = detectSpeech(
      sinal([
        { fala: true, ms: 1500 },
        { fala: false, ms: 3000 },
        { fala: true, ms: 1500 },
      ]),
      SR,
    );
    expect(r).toHaveLength(2);
  });

  // A histerese existe para isto: uma respirada no meio da frase não pode
  // virar duas regiões, senão o corte gruda as metades sem pausa e o Whisper
  // alucina na emenda.
  it("não parte a fala numa pausa curta", () => {
    const r = detectSpeech(
      sinal([
        { fala: true, ms: 1200 },
        { fala: false, ms: 200 },
        { fala: true, ms: 1200 },
      ]),
      SR,
    );
    expect(r).toHaveLength(1);
  });

  // Sem folga, o detector chega tarde e o corte come a primeira sílaba —
  // "não tome" vira "tome", que é a diferença entre duas condutas opostas.
  it("a folga faz a região começar antes da detecção", () => {
    const semFolga = detectSpeech(
      sinal([
        { fala: false, ms: 1000 },
        { fala: true, ms: 2000 },
      ]),
      SR,
      { paddingMs: 0 },
    );
    const comFolga = detectSpeech(
      sinal([
        { fala: false, ms: 1000 },
        { fala: true, ms: 2000 },
      ]),
      SR,
      { paddingMs: 300 },
    );
    expect(comFolga[0]!.startMs).toBeLessThan(semFolga[0]!.startMs);
  });

  // Regressão. A primeira versão usava um percentil baixo como piso de ruído,
  // o que pressupõe bastante silêncio na gravação. Numa consulta é o oposto:
  // as pessoas falam quase o tempo todo, o percentil cai DENTRO da fala, e o
  // detector devolvia zero regiões exatamente no caso normal de uso.
  it("acha a fala mesmo quando quase tudo é fala", () => {
    const r = detectSpeech(
      sinal([
        { fala: true, ms: 9000 },
        { fala: false, ms: 500 },
        { fala: true, ms: 9000 },
      ]),
      SR,
    );
    expect(r.length).toBeGreaterThan(0);
    expect(totalMs(r)).toBeGreaterThan(15_000);
  });

  it("gravação inteiramente de fala não é descartada", () => {
    const r = detectSpeech(sinal([{ fala: true, ms: 5000 }]), SR);
    expect(totalMs(r)).toBeGreaterThan(4000);
  });

  it("áudio curto demais não quebra", () => {
    expect(detectSpeech(new Float32Array(10), SR)).toEqual([]);
    expect(detectSpeech(new Float32Array(0), SR)).toEqual([]);
  });

  // Um estalo do codec produz um quadro digitalmente mudo. Se o piso fosse o
  // mínimo, ele viraria zero e todo o resto viraria "fala".
  it("um quadro mudo não zera o piso de ruído", () => {
    const s = sinal([{ fala: false, ms: 2000 }]);
    for (let i = 0; i < 480; i++) s[i] = 0;
    expect(detectSpeech(s, SR)).toEqual([]);
  });
});

describe("mergeRegions", () => {
  const a: SpeechRegion = { startMs: 0, endMs: 1000 };
  const b: SpeechRegion = { startMs: 1200, endMs: 2000 };

  it("junta o que está perto", () => {
    expect(mergeRegions([a, b], 400)).toEqual([{ startMs: 0, endMs: 2000 }]);
  });

  it("mantém separado o que está longe", () => {
    expect(mergeRegions([a, b], 100)).toHaveLength(2);
  });

  it("ordena antes de juntar", () => {
    expect(mergeRegions([b, a], 400)).toEqual([{ startMs: 0, endMs: 2000 }]);
  });

  it("absorve região contida em outra", () => {
    const r = mergeRegions(
      [
        { startMs: 0, endMs: 5000 },
        { startMs: 1000, endMs: 2000 },
      ],
      0,
    );
    expect(r).toEqual([{ startMs: 0, endMs: 5000 }]);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(mergeRegions([], 400)).toEqual([]);
  });
});

describe("padRegions", () => {
  it("não ultrapassa o começo nem o fim do áudio", () => {
    const r = padRegions([{ startMs: 100, endMs: 4900 }], 500, 5000);
    expect(r[0]).toEqual({ startMs: 0, endMs: 5000 });
  });

  it("a folga pode fundir regiões que ficaram encostadas", () => {
    const r = padRegions(
      [
        { startMs: 0, endMs: 1000 },
        { startMs: 1100, endMs: 2000 },
      ],
      100,
      3000,
    );
    expect(r).toHaveLength(1);
  });
});

describe("mapa de tempo", () => {
  // 0–1s e 3–5s de fala: o áudio enxuto tem 3s.
  const REGIOES: SpeechRegion[] = [
    { startMs: 0, endMs: 1000 },
    { startMs: 3000, endMs: 5000 },
  ];

  it("soma só o que sobrou", () => {
    expect(totalMs(REGIOES)).toBe(3000);
  });

  it("converte tempo enxuto para tempo original", () => {
    expect(toOriginalMs(REGIOES, 500)).toBe(500);
    // 1,5s no enxuto = 0,5s dentro da segunda região = 3,5s no original
    expect(toOriginalMs(REGIOES, 1500)).toBe(3500);
  });

  it("converte tempo original para tempo enxuto", () => {
    expect(toTrimmedMs(REGIOES, 3500)).toBe(1500);
  });

  // A resposta honesta para "onde ficou o segundo 2?" é: não ficou.
  it("instante dentro do silêncio removido não existe no enxuto", () => {
    expect(toTrimmedMs(REGIOES, 2000)).toBeNull();
  });

  it("as duas conversões fecham o ciclo", () => {
    for (const t of [0, 250, 999, 1000, 2500, 2999]) {
      expect(toTrimmedMs(REGIOES, toOriginalMs(REGIOES, t))).toBe(t);
    }
  });

  it("depois do fim devolve o fim, não um tempo inventado", () => {
    expect(toOriginalMs(REGIOES, 99_999)).toBe(5000);
  });
});
