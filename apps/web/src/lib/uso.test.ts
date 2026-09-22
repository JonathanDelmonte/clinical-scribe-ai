import { describe, expect, it } from "vitest";

import { formatarMinutos, formatarReais, nomeDoMes, rotuloDeTipo } from "./uso";

describe("formatação de custo", () => {
  it("mostra centavos como reais", () => {
    expect(formatarReais(0)).toMatch(/R\$\s*0,00/);
    expect(formatarReais(150)).toMatch(/R\$\s*1,50/);
    expect(formatarReais(12_345)).toMatch(/R\$\s*123,45/);
  });

  /**
   * O custo trafega em centavos inteiros do worker à tela. Se em algum ponto
   * virasse `number` em reais, um relatório de dezenas de consultas deixaria
   * de fechar por causa de 0,1 + 0,2 — e um relatório de custo que não fecha
   * é um relatório em que ninguém confia.
   */
  it("soma sem erro de ponto flutuante", () => {
    const centavos = [10, 20, 30, 1, 1, 1];
    expect(formatarReais(centavos.reduce((a, b) => a + b, 0))).toMatch(/R\$\s*0,63/);
  });
});

describe("formatação de minutos", () => {
  it("arredonda", () => {
    expect(formatarMinutos(12.4)).toBe("12 min");
    expect(formatarMinutos(12.6)).toBe("13 min");
  });

  /**
   * "0 min" ao lado de um custo diferente de zero parece defeito. A consulta
   * de quarenta segundos existiu e foi processada.
   */
  it("não mostra zero para consulta curta", () => {
    expect(formatarMinutos(0.7)).toBe("menos de 1 min");
    expect(formatarMinutos(0)).toBe("menos de 1 min");
  });
});

describe("rótulos", () => {
  it("traduz os tipos conhecidos", () => {
    expect(rotuloDeTipo("asr")).toBe("transcrição");
    expect(rotuloDeTipo("llm_note")).toBe("nota clínica");
  });

  it("mostra o tipo cru quando é desconhecido, em vez de sumir com o custo", () => {
    expect(rotuloDeTipo("llm_futuro")).toBe("llm_futuro");
  });
});

describe("nome do mês", () => {
  it("escreve mês e ano em português", () => {
    expect(nomeDoMes(new Date("2026-09-01T03:00:00Z"))).toBe("setembro de 2026");
  });

  /**
   * O início do mês é meia-noite em Brasília, que é 03:00 UTC. Formatado em
   * UTC daria o mês certo; formatado em qualquer fuso a leste daria o mês
   * seguinte no dia 1º. O fuso fixo tira a dúvida.
   */
  it("não escorrega de mês por causa de fuso", () => {
    expect(nomeDoMes(new Date("2026-10-01T03:00:00Z"))).toBe("outubro de 2026");
    expect(nomeDoMes(new Date("2026-09-30T23:59:00-03:00"))).toBe("setembro de 2026");
  });
});
