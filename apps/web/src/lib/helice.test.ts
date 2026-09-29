import { describe, expect, it } from "vitest";

import {
  desenharHelice,
  duracaoDaConversa,
  posicaoNaConversa,
  type Fala,
} from "./helice";

/** Os pares `x y` de um caminho `M x yL x y…`. */
function pontosDe(d: string): [number, number][] {
  return d
    .slice(1)
    .split("L")
    .map((par) => {
      const [x, y] = par.split(" ").map(Number);
      return [x ?? Number.NaN, y ?? Number.NaN];
    });
}

/** O maior afastamento do meio num intervalo de índices. */
function abertura(d: string, de: number, ate: number, meio = 50): number {
  return Math.max(
    ...pontosDe(d)
      .slice(de, ate)
      .map(([, y]) => Math.abs(y - meio)),
  );
}

const CONSULTA: Fala[] = [
  // Primeira metade: o paciente conta a história.
  { role: "patient", startMs: 0, endMs: 50_000 },
  // Segunda metade: o profissional orienta.
  { role: "professional", startMs: 50_000, endMs: 100_000 },
];

describe("hélice da conversa", () => {
  it("não desenha nada sem falas", () => {
    expect(desenharHelice([])).toBeNull();
  });

  it("não desenha nada quando a conversa não tem duração", () => {
    expect(desenharHelice([{ role: "patient", startMs: 0, endMs: 0 }])).toBeNull();
  });

  it("começa no meio da altura e tem um ponto por amostra", () => {
    const h = desenharHelice(CONSULTA, { pontos: 101 });
    expect(h).not.toBeNull();
    if (h === null) return;

    expect(h.voce.startsWith("M0 50")).toBe(true);
    expect(pontosDe(h.voce)).toHaveLength(101);
    expect(pontosDe(h.paciente)).toHaveLength(101);
  });

  it("fica sempre dentro da caixa", () => {
    const h = desenharHelice(CONSULTA, { altura: 40, pontos: 121 });
    if (h === null) throw new Error("esperava uma hélice");

    for (const [x, y] of [...pontosDe(h.voce), ...pontosDe(h.paciente)]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1000);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(40);
    }
  });

  it("engrossa a fita de quem está falando", () => {
    const h = desenharHelice(CONSULTA, { pontos: 201, voltas: 20 });
    if (h === null) throw new Error("esperava uma hélice");

    // Primeiro quarto: só o paciente fala.
    expect(abertura(h.paciente, 10, 40)).toBeGreaterThan(abertura(h.voce, 10, 40) * 2);
    // Último quarto: só o profissional fala.
    expect(abertura(h.voce, 160, 190)).toBeGreaterThan(
      abertura(h.paciente, 160, 190) * 2,
    );
  });

  it("põe o acompanhante do lado do paciente e ignora quem não foi identificado", () => {
    const soAcompanhante = desenharHelice(
      [{ role: "other", startMs: 0, endMs: 10_000 }],
      { pontos: 51, voltas: 5 },
    );
    const soDesconhecido = desenharHelice(
      [{ role: "unknown", startMs: 0, endMs: 10_000 }],
      { pontos: 51, voltas: 5 },
    );
    if (soAcompanhante === null || soDesconhecido === null) {
      throw new Error("esperava duas hélices");
    }

    expect(abertura(soAcompanhante.paciente, 0, 51)).toBeGreaterThan(
      abertura(soAcompanhante.voce, 0, 51),
    );
    // Ninguém identificado: as duas fitas ficam no piso, iguais.
    expect(abertura(soDesconhecido.voce, 0, 51)).toBeCloseTo(
      abertura(soDesconhecido.paciente, 0, 51),
    );
  });
});

describe("posição na conversa", () => {
  it("converte o instante em porcentagem da largura", () => {
    expect(posicaoNaConversa(25_000, 100_000)).toBe(25);
  });

  it("não sai da hélice", () => {
    expect(posicaoNaConversa(-5, 100)).toBe(0);
    expect(posicaoNaConversa(500, 100)).toBe(100);
    expect(posicaoNaConversa(10, 0)).toBe(0);
  });

  it("mede a conversa pelo fim do último trecho", () => {
    expect(duracaoDaConversa(CONSULTA)).toBe(100_000);
  });
});
