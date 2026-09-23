import { describe, expect, it } from "vitest";

import {
  LIMITE_CARACTERES,
  montarVocabulario,
  normalizarEspecialidade,
  VOCABULARIO_COMUM,
  VOCABULARIO_POR_ESPECIALIDADE,
} from "./vocabulary";

describe("normalizarEspecialidade", () => {
  it("tira acento e caixa, que variam conforme quem digitou", () => {
    expect(normalizarEspecialidade("Clínica Médica")).toBe("clinica medica");
    expect(normalizarEspecialidade("  Nutrição ")).toBe("nutricao");
  });
});

describe("montarVocabulario", () => {
  it("usa os termos da especialidade", () => {
    const v = montarVocabulario({ especialidade: "nutrição" });
    expect(v.termos).toContain("levotiroxina");
    expect(v.texto).toContain("levotiroxina");
  });

  it("acha a especialidade escrita de qualquer jeito", () => {
    const a = montarVocabulario({ especialidade: "Clínica Médica" });
    const b = montarVocabulario({ especialidade: "clinica medica" });
    expect(a.termos).toEqual(b.termos);
    expect(a.termos).toContain("losartana");
  });

  // A biblioteca corta pelo FIM. O que vem primeiro sobrevive — então os
  // termos do próprio profissional precisam vir antes de tudo.
  it("os termos do profissional vêm primeiro", () => {
    const v = montarVocabulario({
      especialidade: "nutrição",
      extras: ["Dra. Beatriz", "berberina"],
    });
    expect(v.termos.slice(0, 2)).toEqual(["Dra. Beatriz", "berberina"]);
  });

  it("os termos comuns vêm por último", () => {
    const v = montarVocabulario({ especialidade: "nutrição" });
    const ultimo = v.termos[v.termos.length - 1];
    expect(VOCABULARIO_COMUM).toContain(ultimo);
  });

  // Repetir um termo gasta espaço sem inclinar nada a mais.
  it("não repete termo que está em duas listas", () => {
    const v = montarVocabulario({
      especialidade: "nutrição",
      extras: ["Metformina"],
    });
    const quantas = v.termos.filter((t) => t.toLowerCase() === "metformina").length;
    expect(quantas).toBe(1);
  });

  it("respeita o teto, e diz o que ficou de fora", () => {
    const muitos = Array.from({ length: 200 }, (_, i) => `termo-inventado-${i}`);
    const v = montarVocabulario({ especialidade: null, extras: muitos });
    expect((v.texto ?? "").length).toBeLessThanOrEqual(LIMITE_CARACTERES);
    expect(v.descartados.length).toBeGreaterThan(0);
  });

  it("especialidade desconhecida ainda recebe os termos comuns", () => {
    const v = montarVocabulario({ especialidade: "astrologia" });
    expect(v.termos).toEqual([...VOCABULARIO_COMUM]);
  });

  it("sem especialidade, recebe os termos comuns", () => {
    expect(montarVocabulario({ especialidade: null }).termos).toEqual([
      ...VOCABULARIO_COMUM,
    ]);
  });

  it("ignora termo vazio vindo de fora", () => {
    const v = montarVocabulario({ especialidade: null, extras: ["", "   "] });
    expect(v.termos).toEqual([...VOCABULARIO_COMUM]);
  });
});

describe("as listas", () => {
  // Cada lista de especialidade, sozinha, precisa caber inteira. Uma lista que
  // não cabe é uma lista cujo fim nunca é usado — e ninguém percebe.
  it("toda especialidade cabe no teto sem cortar nada", () => {
    for (const [nome, termos] of Object.entries(VOCABULARIO_POR_ESPECIALIDADE)) {
      const v = montarVocabulario({ especialidade: nome });
      expect(v.descartados, `a lista de ${nome} não cabe`).toEqual([]);
      expect(v.termos.length).toBeGreaterThanOrEqual(termos.length);
    }
  });

  it("as chaves já estão na forma normalizada", () => {
    for (const nome of Object.keys(VOCABULARIO_POR_ESPECIALIDADE)) {
      expect(normalizarEspecialidade(nome)).toBe(nome);
    }
  });
});
