import { describe, expect, it } from "vitest";

import type { CitedStatement, TranscriptSegment } from "./domain.js";
import {
  formatSegmentsForPrompt,
  formatTimestamp,
  isBlocking,
  resolveCitations,
  validateCitations,
} from "./citations.js";

function segment(
  id: string,
  overrides: Partial<TranscriptSegment> = {},
): TranscriptSegment {
  return {
    id,
    speakerLabel: "SPEAKER_00",
    role: "patient",
    roleSource: "llm",
    startMs: 0,
    endMs: 1000,
    text: "texto",
    confidence: 0.9,
    ...overrides,
  };
}

function statement(
  path: string,
  sources: string[],
  text = "afirmação",
): CitedStatement {
  return { path, text, sources };
}

describe("validateCitations", () => {
  const segments = [
    segment("seg_a1", { role: "professional", startMs: 32_000, endMs: 36_000 }),
    segment("seg_b2", { startMs: 38_000, endMs: 44_000 }),
  ];

  it("aceita citações que apontam para trechos existentes", () => {
    const issues = validateCitations(
      [statement("subjetivo.queixaPrincipal", ["seg_b2"])],
      segments,
    );
    expect(issues).toEqual([]);
  });

  it("detecta ID inventado pelo modelo", () => {
    const issues = validateCitations(
      [statement("objetivo.exameFisico", ["seg_inexistente"])],
      segments,
    );
    expect(issues).toEqual([
      {
        kind: "unknown_segment",
        path: "objetivo.exameFisico",
        segmentId: "seg_inexistente",
      },
    ]);
  });

  it("detecta afirmação clínica sem nenhuma fonte", () => {
    const issues = validateCitations([statement("plano.conduta", [])], segments);
    expect(issues).toEqual([{ kind: "missing_sources", path: "plano.conduta" }]);
  });

  it("reporta cada ID inválido separadamente", () => {
    const issues = validateCitations(
      [statement("plano.conduta", ["seg_a1", "seg_x", "seg_y"])],
      segments,
    );
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.kind === "unknown_segment")).toBe(true);
  });

  it("sinaliza fonte duplicada sem bloquear", () => {
    const issues = validateCitations(
      [statement("plano.conduta", ["seg_a1", "seg_a1"])],
      segments,
    );
    expect(issues).toEqual([
      { kind: "duplicate_source", path: "plano.conduta", segmentId: "seg_a1" },
    ]);
    expect(issues.filter(isBlocking)).toEqual([]);
  });

  it("não confunde afirmações diferentes", () => {
    const issues = validateCitations(
      [
        statement("a", ["seg_a1"]),
        statement("b", ["seg_fantasma"]),
        statement("c", []),
      ],
      segments,
    );
    expect(issues.map((i) => i.path)).toEqual(["b", "c"]);
  });
});

describe("resolveCitations", () => {
  const segments = [
    segment("seg_a1", { startMs: 32_000, endMs: 36_000 }),
    segment("seg_b2", { startMs: 38_000, endMs: 44_000 }),
    segment("seg_c3", { startMs: 10_000, endMs: 12_000 }),
  ];

  it("devolve o intervalo que cobre todas as fontes, em ordem cronológica", () => {
    const resolved = resolveCitations(statement("x", ["seg_b2", "seg_c3"]), segments);
    expect(resolved).not.toBeNull();
    expect(resolved?.startMs).toBe(10_000);
    expect(resolved?.endMs).toBe(44_000);
    expect(resolved?.segments.map((s) => s.id)).toEqual(["seg_c3", "seg_b2"]);
  });

  it("devolve null quando nenhuma fonte existe", () => {
    expect(resolveCitations(statement("x", ["seg_zzz"]), segments)).toBeNull();
  });

  it("ignora fontes inexistentes mas aproveita as válidas", () => {
    const resolved = resolveCitations(statement("x", ["seg_zzz", "seg_a1"]), segments);
    expect(resolved?.segments.map((s) => s.id)).toEqual(["seg_a1"]);
  });
});

describe("formatSegmentsForPrompt", () => {
  it("expõe o ID entre colchetes — é o que o modelo deve copiar", () => {
    const rendered = formatSegmentsForPrompt([
      segment("seg_a1", {
        role: "professional",
        startMs: 32_000,
        text: "Há quanto tempo você sente essa dor?",
      }),
      segment("seg_b2", {
        role: "patient",
        startMs: 38_000,
        text: "Uns três dias, começou depois do treino",
      }),
    ]);

    expect(rendered).toBe(
      "[seg_a1] PROFISSIONAL (00:32): Há quanto tempo você sente essa dor?\n" +
        "[seg_b2] PACIENTE (00:38): Uns três dias, começou depois do treino",
    );
  });

  it("rotula papel indefinido em vez de omitir", () => {
    const rendered = formatSegmentsForPrompt([segment("seg_a1", { role: "unknown" })]);
    expect(rendered).toContain("INDEFINIDO");
  });
});

describe("formatTimestamp", () => {
  it.each([
    [0, "00:00"],
    [32_000, "00:32"],
    [61_500, "01:01"],
    [3_600_000, "60:00"],
  ])("formata %ims como %s", (ms, expected) => {
    expect(formatTimestamp(ms)).toBe(expected);
  });
});
