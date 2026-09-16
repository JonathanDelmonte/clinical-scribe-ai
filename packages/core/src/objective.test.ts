import { describe, expect, it } from "vitest";

import type { TranscriptSegment } from "./domain";
import {
  buildObjectivePrompt,
  countGaps,
  objetivoPorSlug,
  OBJETIVOS_GLOBAIS,
  parseObjectiveResponse,
  PROMPT_VERSION_OBJETIVO,
  validateObjective,
} from "./objective";

function trecho(id: string, text: string): TranscriptSegment {
  return {
    id,
    speakerLabel: "SPEAKER_00",
    role: "professional",
    roleSource: "llm",
    startMs: 0,
    endMs: 3000,
    text,
    confidence: 0.9,
  };
}

const TRECHOS = [
  trecho("seg_a", "Vou passar um relaxante muscular para você."),
  trecho("seg_b", "Tome dipirona 500 miligramas de seis em seis horas por três dias."),
  trecho("seg_c", "Vou te encaminhar para um especialista."),
];

const RECEITA = objetivoPorSlug("receita");
if (RECEITA === null) throw new Error("template receita ausente");

describe("buildObjectivePrompt", () => {
  it("expõe os identificadores citáveis", () => {
    const p = buildObjectivePrompt(TRECHOS, RECEITA);
    expect(p).toContain("[seg_a]");
    expect(p).toContain("[seg_b]");
  });

  it("carrega a instrução específica do objetivo", () => {
    expect(buildObjectivePrompt(TRECHOS, RECEITA)).toContain("medicamentos");
  });

  // A regra que separa este prompt do da nota. Uma receita cria um ato
  // clínico; completar a dose que "faria sentido" emite uma prescrição que
  // ninguém fez.
  it("proíbe completar o que não foi dito, e manda declarar a lacuna", () => {
    const p = buildObjectivePrompt(TRECHOS, RECEITA);
    expect(p).toContain("NUNCA COMPLETE O QUE NÃO FOI DITO");
    expect(p).toContain("lacunas");
  });

  it("autoriza devolver lista vazia", () => {
    expect(buildObjectivePrompt(TRECHOS, RECEITA)).toContain("SE NADA FOI DITO");
  });
});

describe("parseObjectiveResponse", () => {
  const RESPOSTA = JSON.stringify({
    titulo: "Receita",
    itens: [
      {
        texto: "Dipirona 500mg, 6/6h por 3 dias",
        fontes: ["seg_b"],
        lacunas: [],
      },
      {
        texto: "Relaxante muscular",
        fontes: ["seg_a"],
        lacunas: ["nome do medicamento", "dose", "posologia"],
      },
    ],
  });

  it("lê uma resposta bem formada", () => {
    const r = parseObjectiveResponse(RESPOSTA);
    expect(r.title).toBe("Receita");
    expect(r.items).toHaveLength(2);
  });

  it("preserva as lacunas declaradas", () => {
    const r = parseObjectiveResponse(RESPOSTA);
    expect(r.items[1]?.gaps).toEqual(["nome do medicamento", "dose", "posologia"]);
  });

  it("aceita JSON dentro de bloco de código", () => {
    expect(parseObjectiveResponse("```json\n" + RESPOSTA + "\n```").items).toHaveLength(
      2,
    );
  });

  it("devolve vazio para resposta que não é JSON", () => {
    expect(parseObjectiveResponse("não consegui").items).toEqual([]);
  });

  it("item sem texto é descartado", () => {
    const r = parseObjectiveResponse(
      JSON.stringify({ titulo: "x", itens: [{ texto: "  ", fontes: ["seg_a"] }] }),
    );
    expect(r.items).toEqual([]);
  });

  it("mantém item sem fonte, para a validação reportar depois", () => {
    const r = parseObjectiveResponse(
      JSON.stringify({ titulo: "x", itens: [{ texto: "Algo", fontes: [] }] }),
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.sources).toEqual([]);
  });

  it("lacuna que não é texto é descartada", () => {
    const r = parseObjectiveResponse(
      JSON.stringify({
        titulo: "x",
        itens: [{ texto: "A", fontes: ["seg_a"], lacunas: ["dose", 7, "", null] }],
      }),
    );
    expect(r.items[0]?.gaps).toEqual(["dose"]);
  });

  // Consulta sem prescrição deve produzir receita vazia, não uma inventada.
  it("lista vazia é uma resposta válida", () => {
    const r = parseObjectiveResponse(JSON.stringify({ titulo: "Receita", itens: [] }));
    expect(r.title).toBe("Receita");
    expect(r.items).toEqual([]);
  });
});

describe("validateObjective", () => {
  it("aceita item cuja citação existe", () => {
    const p = parseObjectiveResponse(
      JSON.stringify({ titulo: "x", itens: [{ texto: "A", fontes: ["seg_b"] }] }),
    );
    expect(validateObjective(p, TRECHOS).acceptable).toBe(true);
  });

  it("bloqueia item que cita trecho inexistente", () => {
    const p = parseObjectiveResponse(
      JSON.stringify({
        titulo: "x",
        itens: [{ texto: "Amoxicilina 500mg", fontes: ["seg_zzz"] }],
      }),
    );
    const v = validateObjective(p, TRECHOS);
    expect(v.acceptable).toBe(false);
    expect(v.blocking[0]?.kind).toBe("unknown_segment");
  });

  it("bloqueia item sem fonte alguma", () => {
    const p = parseObjectiveResponse(
      JSON.stringify({ titulo: "x", itens: [{ texto: "Ibuprofeno", fontes: [] }] }),
    );
    expect(validateObjective(p, TRECHOS).acceptable).toBe(false);
  });
});

describe("countGaps", () => {
  it("conta os itens incompletos, não as lacunas", () => {
    const p = parseObjectiveResponse(
      JSON.stringify({
        titulo: "x",
        itens: [
          { texto: "A", fontes: ["seg_a"], lacunas: ["dose", "via"] },
          { texto: "B", fontes: ["seg_b"], lacunas: [] },
        ],
      }),
    );
    expect(countGaps(p)).toBe(1);
  });
});

describe("biblioteca de objetivos", () => {
  it("os slugs são únicos", () => {
    const slugs = OBJETIVOS_GLOBAIS.map((o) => o.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("cada objetivo tem um tipo de documento válido", () => {
    for (const o of OBJETIVOS_GLOBAIS) {
      expect(o.documentType).toBeTruthy();
      expect(o.prompt.length).toBeGreaterThan(40);
    }
  });

  it("slug desconhecido devolve nulo em vez de lançar", () => {
    expect(objetivoPorSlug("receita-de-bolo")).toBeNull();
  });

  it("a versão do prompt é gravável", () => {
    expect(PROMPT_VERSION_OBJETIVO).toMatch(/^objetivo-v\d+$/);
  });
});
