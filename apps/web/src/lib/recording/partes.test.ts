import { describe, expect, it } from "vitest";

import { esperaDeTentativa, partesFaltando, planejarPartes } from "./partes";

describe("plano de partes", () => {
  it("divide em pedaços do tamanho pedido", () => {
    expect(planejarPartes(250, 100)).toEqual([
      { indice: 0, inicio: 0, fim: 100 },
      { indice: 1, inicio: 100, fim: 200 },
      { indice: 2, inicio: 200, fim: 250 },
    ]);
  });

  /**
   * Os deslocamentos precisam cobrir o arquivo inteiro, sem sobra e sem
   * buraco. Um erro de um byte aqui produz um áudio remontado com um salto no
   * meio — e nenhum erro aparece em lugar nenhum, porque o arquivo continua
   * sendo um arquivo válido.
   */
  it("cobre o arquivo inteiro exatamente uma vez", () => {
    for (const total of [1, 99, 100, 101, 1024, 7777]) {
      const partes = planejarPartes(total, 100);
      expect(partes[0]?.inicio).toBe(0);
      expect(partes[partes.length - 1]?.fim).toBe(total);
      for (let i = 1; i < partes.length; i++) {
        expect(partes[i]?.inicio).toBe(partes[i - 1]?.fim);
      }
    }
  });

  it("cabe numa parte só quando o arquivo é menor que ela", () => {
    expect(planejarPartes(50, 100)).toEqual([{ indice: 0, inicio: 0, fim: 50 }]);
  });

  it("não planeja nada para arquivo vazio", () => {
    expect(planejarPartes(0, 100)).toEqual([]);
    expect(planejarPartes(100, 0)).toEqual([]);
  });
});

describe("retomada", () => {
  const plano = planejarPartes(500, 100);

  it("pede só o que falta", () => {
    expect(partesFaltando(plano, [0, 1, 3]).map((p) => p.indice)).toEqual([2, 4]);
  });

  it("não pede nada quando tudo chegou", () => {
    expect(partesFaltando(plano, [0, 1, 2, 3, 4])).toEqual([]);
  });

  it("pede tudo quando nada chegou", () => {
    expect(partesFaltando(plano, [])).toHaveLength(5);
  });

  it("ignora índices que o servidor reporta e não estão no plano", () => {
    expect(partesFaltando(plano, [0, 1, 2, 3, 4, 99])).toEqual([]);
  });
});

describe("espera entre tentativas", () => {
  it("cresce exponencialmente e para de crescer", () => {
    const semRuido = () => 0.5;
    expect(esperaDeTentativa(0, semRuido)).toBe(1000);
    expect(esperaDeTentativa(1, semRuido)).toBe(2000);
    expect(esperaDeTentativa(2, semRuido)).toBe(4000);
    expect(esperaDeTentativa(3, semRuido)).toBe(8000);
    expect(esperaDeTentativa(9, semRuido)).toBe(8000);
  });

  /**
   * Sem a variação, todos os pedaços pendentes voltariam juntos no instante em
   * que a rede voltasse — e derrubariam a conexão de novo.
   */
  it("espalha as tentativas em torno da base", () => {
    expect(esperaDeTentativa(0, () => 0)).toBe(750);
    expect(esperaDeTentativa(0, () => 0.999)).toBe(1250);
  });
});
