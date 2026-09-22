import { describe, expect, it } from "vitest";

import {
  notaComoTexto,
  objetivoComoTexto,
  RODAPE,
  temposDasFontes,
  tituloDaSecao,
  type CabecalhoDeExportacao,
} from "./texto";

const TRECHOS = [
  { id: "a", startMs: 462_000 },
  { id: "b", startMs: 12_000 },
  { id: "c", startMs: 900_000 },
];

const CABECALHO: CabecalhoDeExportacao = {
  paciente: "Ana Beatriz",
  nascimento: "15/03/1990",
  profissional: "Dra. Ana Ribeiro",
  registro: "CRN-3 12345",
  especialidade: "nutrição",
  dataDaConsulta: new Date("2026-09-22T17:30:00Z"),
  duracaoMs: 11 * 60_000,
};

describe("tempos das fontes", () => {
  it("converte IDs em minutos, em ordem", () => {
    expect(temposDasFontes(["a", "b"], TRECHOS)).toEqual(["00:12", "07:42"]);
  });

  it("não repete o mesmo tempo", () => {
    const iguais = [
      { id: "x", startMs: 5000 },
      { id: "y", startMs: 5000 },
    ];
    expect(temposDasFontes(["x", "y"], iguais)).toEqual(["00:05"]);
  });

  /**
   * Uma fonte que não existe entre os trechos é omitida, nunca inventada. A
   * conferência determinística barra uma nota nesse estado antes da aprovação;
   * num documento que já saiu daqui, um tempo inventado seria pior do que
   * tempo nenhum.
   */
  it("omite fonte inexistente em vez de inventar um tempo", () => {
    expect(temposDasFontes(["a", "fantasma"], TRECHOS)).toEqual(["07:42"]);
    expect(temposDasFontes(["fantasma"], TRECHOS)).toEqual([]);
  });
});

describe("nota como texto", () => {
  const secoes = [
    {
      key: "queixaPrincipal",
      statements: [{ text: "Dor abdominal há três dias.", sources: ["b"] }],
    },
    { key: "exameFisico", statements: [] },
    {
      key: "conduta",
      statements: [
        { text: "Solicitado hemograma.", sources: ["a", "c"] },
        {
          text: "Retorno em duas semanas.",
          sources: [],
          confirmedAt: "2026-09-22T18:00:00Z",
        },
      ],
    },
  ];

  const texto = notaComoTexto(CABECALHO, secoes, TRECHOS);

  it("abre com paciente, profissional e registro", () => {
    expect(texto).toContain("Paciente: Ana Beatriz (nasc. 15/03/1990)");
    expect(texto).toContain("Profissional: Dra. Ana Ribeiro — CRN-3 12345 · nutrição");
  });

  it("marca cada afirmação com os tempos do áudio", () => {
    expect(texto).toContain("- Dor abdominal há três dias. [00:12]");
    expect(texto).toContain("- Solicitado hemograma. [07:42, 15:00]");
  });

  /**
   * Sem âncora e assumido pelo profissional: o documento diz isso em vez de
   * ficar em silêncio. É a transferência explícita de responsabilidade que o
   * fluxo de aprovação registra — e ela precisa sobreviver à exportação.
   */
  it("diz quando a afirmação foi assumida sem âncora", () => {
    expect(texto).toContain("- Retorno em duas semanas. [assumido pelo profissional]");
  });

  /**
   * Um "Exame físico" com um travessão embaixo, numa consulta em que ninguém
   * examinou nada, é uma seção que parece ter sido preenchida.
   */
  it("omite seção sem afirmações", () => {
    expect(texto).not.toContain("EXAME FÍSICO");
    expect(texto).toContain("QUEIXA PRINCIPAL");
    expect(texto).toContain("CONDUTA");
  });

  /**
   * O caso perigoso: fontes que não existem entre os trechos. Sem marca
   * explícita, a afirmação fabricada fica visualmente idêntica a uma
   * afirmação comum — que é exatamente como 62% dos achados inventados
   * passam despercebidos.
   */
  it("marca a afirmação cujas fontes não existem", () => {
    const fabricada = notaComoTexto(
      CABECALHO,
      [
        {
          key: "conduta",
          statements: [{ text: "Vitamina D 2000 UI ao dia.", sources: ["fantasma"] }],
        },
      ],
      TRECHOS,
    );
    expect(fabricada).toContain("- Vitamina D 2000 UI ao dia. [sem âncora no áudio]");
  });

  it("declara a origem do documento no rodapé", () => {
    expect(texto.endsWith(RODAPE)).toBe(true);
  });

  it("informa a duração da gravação quando há", () => {
    expect(texto).toContain("Duração da gravação: 11 minutos");
    expect(
      notaComoTexto({ ...CABECALHO, duracaoMs: null }, secoes, TRECHOS),
    ).not.toContain("Duração");
  });

  it("aceita profissional sem registro e paciente sem nascimento", () => {
    const enxuto = notaComoTexto(
      { ...CABECALHO, registro: null, nascimento: null, especialidade: null },
      secoes,
      TRECHOS,
    );
    expect(enxuto).toContain("Paciente: Ana Beatriz\n");
    expect(enxuto).toContain("Profissional: Dra. Ana Ribeiro\n");
  });
});

describe("objetivo como texto", () => {
  it("usa o título do documento e lista os itens", () => {
    const texto = objetivoComoTexto(
      CABECALHO,
      "Receita",
      [{ text: "Dipirona 500 mg, se dor.", sources: ["a"] }],
      TRECHOS,
    );
    expect(texto.startsWith("RECEITA")).toBe(true);
    expect(texto).toContain("- Dipirona 500 mg, se dor. [07:42]");
    expect(texto).toContain(RODAPE);
  });

  it("não fica sem título quando o modelo não deu um", () => {
    expect(objetivoComoTexto(CABECALHO, "", [], TRECHOS).startsWith("DOCUMENTO")).toBe(
      true,
    );
  });
});

describe("título de seção", () => {
  it("traduz as chaves conhecidas", () => {
    expect(tituloDaSecao("queixaPrincipal")).toBe("Queixa principal");
  });

  it("devolve a própria chave para as desconhecidas, em vez de sumir", () => {
    expect(tituloDaSecao("secaoInventada")).toBe("secaoInventada");
  });
});
