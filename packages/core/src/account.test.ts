import { describe, expect, it } from "vitest";

import type { Account, Engine, Plan, UserRole } from "./account.js";
import {
  canChooseEngine,
  canProcess,
  remainingMinutes,
  resolveEngine,
} from "./account.js";

function account(
  role: UserRole,
  plan: Plan,
  preferredEngine: Engine | null = null,
): Account {
  return { role, plan, preferredEngine };
}

describe("resolveEngine — padrão do plano", () => {
  it.each([
    ["free", "local"],
    ["pro", "cloud"],
    ["clinic", "cloud"],
  ] as const)("plano %s recebe o motor %s", (plan, engine) => {
    const decision = resolveEngine(account("professional", plan));
    expect(decision.engine).toBe(engine);
    expect(decision.reason).toBe("plan-default");
  });
});

describe("resolveEngine — só desenvolvedor escolhe", () => {
  it("desenvolvedor escolhe o motor da sessão", () => {
    const decision = resolveEngine(account("developer", "free"), "cloud");
    expect(decision).toEqual({
      engine: "cloud",
      reason: "developer-choice",
      ignoredChoice: null,
    });
  });

  it("desenvolvedor pode forçar o local mesmo estando no Pro", () => {
    const decision = resolveEngine(account("developer", "pro"), "local");
    expect(decision.engine).toBe("local");
    expect(decision.reason).toBe("developer-choice");
  });

  it("preferência persistente do desenvolvedor vale quando a sessão não escolhe", () => {
    const decision = resolveEngine(account("developer", "free", "cloud"));
    expect(decision.engine).toBe("cloud");
    expect(decision.reason).toBe("developer-choice");
  });

  it("escolha da sessão tem precedência sobre a preferência persistente", () => {
    const decision = resolveEngine(account("developer", "free", "cloud"), "local");
    expect(decision.engine).toBe("local");
  });

  it("desenvolvedor sem escolha nenhuma cai no padrão do plano", () => {
    const decision = resolveEngine(account("developer", "free"));
    expect(decision.engine).toBe("local");
    expect(decision.reason).toBe("plan-default");
  });
});

describe("resolveEngine — a regra que protege o caixa", () => {
  it("plano grátis NÃO consegue pedir o motor que custa dinheiro", () => {
    const decision = resolveEngine(account("professional", "free"), "cloud");
    expect(decision.engine).toBe("local");
    expect(decision.reason).toBe("plan-default");
    // Descartado, e visível — não sumiu em silêncio.
    expect(decision.ignoredChoice).toBe("cloud");
  });

  it("preferência persistente de não-desenvolvedor é ignorada", () => {
    const decision = resolveEngine(account("professional", "free", "cloud"));
    expect(decision.engine).toBe("local");
    expect(decision.reason).toBe("plan-default");
  });

  it("não marca ignoredChoice quando ninguém pediu nada", () => {
    expect(resolveEngine(account("professional", "free")).ignoredChoice).toBeNull();
  });

  it("nem o Pro escolhe — assinar não dá permissão de desenvolvedor", () => {
    const decision = resolveEngine(account("professional", "pro"), "local");
    expect(decision.engine).toBe("cloud");
    expect(decision.ignoredChoice).toBe("local");
  });
});

describe("canChooseEngine", () => {
  it.each([
    ["developer", true],
    ["professional", false],
  ] as const)("%s → %s", (role, expected) => {
    expect(canChooseEngine(account(role, "pro"))).toBe(expected);
  });
});

describe("remainingMinutes", () => {
  it("plano grátis tem teto de 300 min", () => {
    expect(remainingMinutes("free", 0)).toBe(300);
    expect(remainingMinutes("free", 120)).toBe(180);
  });

  it("nunca devolve negativo", () => {
    expect(remainingMinutes("free", 500)).toBe(0);
  });

  it.each(["pro", "clinic"] as const)("plano %s não tem teto", (plan) => {
    expect(remainingMinutes(plan, 10_000)).toBeNull();
  });
});

describe("canProcess", () => {
  it("libera quando cabe na quota", () => {
    expect(canProcess(account("professional", "free"), 200, 30)).toEqual({
      allowed: true,
    });
  });

  it("bloqueia ANTES de processar quando não cabe", () => {
    const result = canProcess(account("professional", "free"), 290, 30);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("10 min");
      expect(result.reason).toContain("30 min");
    }
  });

  it("bloqueia com a quota exatamente esgotada", () => {
    expect(canProcess(account("professional", "free"), 300, 1).allowed).toBe(false);
  });

  it("aceita a sessão que usa o último minuto exato", () => {
    expect(canProcess(account("professional", "free"), 280, 20).allowed).toBe(true);
  });

  it("desenvolvedor não tem quota — senão não dá para testar o produto", () => {
    expect(canProcess(account("developer", "free"), 99_999, 60).allowed).toBe(true);
  });

  it.each(["pro", "clinic"] as const)("plano %s não é bloqueado por quota", (plan) => {
    expect(canProcess(account("professional", plan), 99_999, 60).allowed).toBe(true);
  });
});
