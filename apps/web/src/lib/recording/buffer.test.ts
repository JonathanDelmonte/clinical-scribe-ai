import { describe, expect, it } from "vitest";

import { emOrdem } from "./buffer";

const pedaco = (texto: string) => new Blob([texto]);

async function texto(pedacos: Blob[]): Promise<string> {
  return new Blob(pedacos).text();
}

describe("remontar a gravação", () => {
  it("põe em ordem de índice, não na ordem em que chegaram", async () => {
    const doAparelho = [
      { indice: 2, dados: pedaco("c") },
      { indice: 0, dados: pedaco("a") },
      { indice: 1, dados: pedaco("b") },
    ];
    expect(await texto(emOrdem(doAparelho, new Map()))).toBe("abc");
  });

  // O aparelho recusou o pedaço 1 (sem espaço): ele ficou na memória da aba.
  it("encaixa os pedaços da memória no buraco que o aparelho deixou", async () => {
    const doAparelho = [
      { indice: 0, dados: pedaco("a") },
      { indice: 2, dados: pedaco("c") },
    ];
    expect(await texto(emOrdem(doAparelho, new Map([[1, pedaco("b")]])))).toBe("abc");
  });

  it("sem o aparelho, a memória sozinha", async () => {
    const memoria = new Map([
      [1, pedaco("b")],
      [0, pedaco("a")],
    ]);
    expect(await texto(emOrdem([], memoria))).toBe("ab");
  });
});
