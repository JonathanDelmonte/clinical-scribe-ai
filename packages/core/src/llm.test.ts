import { describe, expect, it } from "vitest";

import { checkDataPolicy, dataPolicyLabel } from "./llm";

const GRATIS = { name: "google-ai-studio", dataPolicy: "training" } as const;
const PAGO = { name: "google-vertex", dataPolicy: "contractual" } as const;

describe("checkDataPolicy", () => {
  it("ambiente que exige contrato recusa fornecedor que treina", () => {
    const r = checkDataPolicy(GRATIS, "contractual");
    expect(r.allowed).toBe(false);
  });

  it("ambiente que exige contrato aceita fornecedor com contrato", () => {
    expect(checkDataPolicy(PAGO, "contractual").allowed).toBe(true);
  });

  // Desenvolvimento aceita os dois: quem tem termos contratuais também serve
  // para testar. O piso é o mínimo tolerado, não uma correspondência exata.
  it("ambiente de desenvolvimento aceita os dois", () => {
    expect(checkDataPolicy(GRATIS, "training").allowed).toBe(true);
    expect(checkDataPolicy(PAGO, "training").allowed).toBe(true);
  });

  // A recusa acontece na partida do worker, longe de quem a causou. Sem o
  // caminho da solução no texto, vira meia hora procurando qual variável mexer.
  it("a recusa diz qual variável resolve", () => {
    const r = checkDataPolicy(GRATIS, "contractual");
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toContain("LLM_DATA_POLICY");
      expect(r.reason).toContain("google-ai-studio");
    }
  });
});

describe("dataPolicyLabel", () => {
  it("o aviso do nível grátis menciona paciente real", () => {
    expect(dataPolicyLabel("training")).toContain("paciente real");
  });

  it("distingue as duas políticas", () => {
    expect(dataPolicyLabel("training")).not.toBe(dataPolicyLabel("contractual"));
  });
});
