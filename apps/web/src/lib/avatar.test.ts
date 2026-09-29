import { describe, expect, it } from "vitest";

import { iniciais, luzDoAvatar } from "./avatar";

describe("iniciais", () => {
  it("usa o primeiro e o último nome", () => {
    expect(iniciais("Mariana Costa")).toBe("MC");
    expect(iniciais("João Pedro Pereira")).toBe("JP");
  });

  it("pula as partículas do nome", () => {
    expect(iniciais("Maria das Graças")).toBe("MG");
    expect(iniciais("Carlos de Souza e Silva")).toBe("CS");
  });

  it("aguenta nome único, acento e espaços sobrando", () => {
    expect(iniciais("  ágata  ")).toBe("Á");
    expect(iniciais("Élcio   Ômega")).toBe("ÉÔ");
  });

  it("ignora título e comentário entre parênteses", () => {
    expect(iniciais("Dra. Ana Ribeiro")).toBe("AR");
    expect(iniciais("Marina Alves (exemplo)")).toBe("MA");
    expect(iniciais("Júlia (filha da Marta)")).toBe("J");
  });

  it("não quebra com nome vazio", () => {
    expect(iniciais("   ")).toBe("?");
    expect(iniciais("(sem nome)")).toBe("?");
  });
});

describe("luz do avatar", () => {
  it("é sempre a mesma para a mesma pessoa", () => {
    expect(luzDoAvatar("5eeded00-0000-4000-8000-000000000001")).toBe(
      luzDoAvatar("5eeded00-0000-4000-8000-000000000001"),
    );
  });

  it("é um gradiente", () => {
    expect(luzDoAvatar("qualquer")).toMatch(
      /^linear-gradient\(140deg, #[0-9A-F]{6}, #[0-9A-F]{6}\)$/,
    );
  });
});
