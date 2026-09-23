import { describe, expect, it } from "vitest";

import {
  dataParaExibicao,
  dataParaFormulario,
  idadeEmAnos,
  padraoDeBusca,
} from "./patients";

describe("padrão de busca", () => {
  it("envolve o termo em curingas", () => {
    expect(padraoDeBusca("ana")).toBe("%ana%");
  });

  it("ignora espaços nas pontas", () => {
    expect(padraoDeBusca("  ana  ")).toBe("%ana%");
  });

  it("devolve null para busca vazia", () => {
    expect(padraoDeBusca("")).toBeNull();
    expect(padraoDeBusca("   ")).toBeNull();
  });

  /**
   * Sem o escape, digitar `%` na busca listaria TODOS os pacientes — o
   * contrário do que a pessoa pediu, e com cara de defeito.
   */
  it("escapa os curingas do LIKE", () => {
    expect(padraoDeBusca("100%")).toBe("%100\\%%");
    expect(padraoDeBusca("a_b")).toBe("%a\\_b%");
  });

  it("escapa a própria barra invertida", () => {
    expect(padraoDeBusca("a\\b")).toBe("%a\\\\b%");
  });
});

describe("idade", () => {
  const hoje = new Date("2026-09-22T12:00:00Z");

  it("conta anos completos", () => {
    expect(idadeEmAnos(new Date("1985-04-12"), hoje)).toBe(41);
  });

  it("não conta o ano no dia anterior ao aniversário", () => {
    expect(idadeEmAnos(new Date("1985-09-23"), hoje)).toBe(40);
  });

  it("conta o ano no dia do aniversário", () => {
    expect(idadeEmAnos(new Date("1985-09-22"), hoje)).toBe(41);
  });

  /** 29 de fevereiro é onde a conta em milissegundos erra. */
  it("acerta quem nasceu em 29 de fevereiro", () => {
    expect(idadeEmAnos(new Date("2000-02-29"), new Date("2026-02-28T12:00:00Z"))).toBe(
      25,
    );
    expect(idadeEmAnos(new Date("2000-02-29"), new Date("2026-03-01T12:00:00Z"))).toBe(
      26,
    );
  });

  it("devolve null para data futura ou inválida", () => {
    expect(idadeEmAnos(new Date("2030-01-01"), hoje)).toBeNull();
    expect(idadeEmAnos(new Date("não é data"), hoje)).toBeNull();
  });
});

describe("datas na interface", () => {
  it("exibe no formato brasileiro", () => {
    expect(dataParaExibicao("1985-04-12")).toBe("12/04/1985");
    expect(dataParaExibicao("1985-04-12T00:00:00.000Z")).toBe("12/04/1985");
  });

  /**
   * A coluna é `date` e chega como meia-noite UTC. Formatar com métodos
   * locais devolveria o dia anterior em todo o Brasil — e o paciente
   * envelheceria um dia a cada ida e volta pelo formulário.
   */
  it("mantém o dia ao voltar para o formulário", () => {
    expect(dataParaFormulario(new Date("1985-04-12T00:00:00.000Z"))).toBe("1985-04-12");
  });

  it("devolve vazio para data ausente", () => {
    expect(dataParaFormulario(null)).toBe("");
    expect(dataParaFormulario(new Date("nada"))).toBe("");
  });
});

describe("idade e fuso horário", () => {
  /**
   * Regressão. A implementação anterior lia a data de nascimento com métodos
   * locais. A coluna é `date` e o driver entrega meia-noite UTC, então em
   * qualquer fuso a oeste de Greenwich — o Brasil inteiro — o dia escorregava
   * para trás e a idade saía um ano errada perto do aniversário.
   *
   * O detalhe que fez isso passar despercebido: em UTC os dois referenciais
   * coincidem. A suíte ficava verde no CI e o defeito só existia em produção.
   */
  it("a véspera do aniversário não conta o ano, no fuso do Brasil", () => {
    const vespera = new Date("2026-09-22T12:00:00-03:00");
    expect(idadeEmAnos(new Date("1985-09-23"), vespera)).toBe(40);
  });

  it("o dia do aniversário conta o ano, no fuso do Brasil", () => {
    const aniversario = new Date("2026-09-23T12:00:00-03:00");
    expect(idadeEmAnos(new Date("1985-09-23"), aniversario)).toBe(41);
  });

  it("primeiro de janeiro de madrugada em São Paulo ainda é o ano novo", () => {
    // 01/01 às 00:30 em São Paulo é 03:30 UTC do mesmo dia — mas quem nasceu
    // em 01/01 faz aniversário AGORA, no calendário de quem olha a tela.
    const madrugada = new Date("2026-01-01T00:30:00-03:00");
    expect(idadeEmAnos(new Date("2000-01-01"), madrugada)).toBe(26);
  });
});
