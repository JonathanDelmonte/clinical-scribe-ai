import { describe, expect, it } from "vitest";

import { inicioDoMes } from "./quota";

/**
 * Só a fronteira do mês é testada aqui. O resto de `quota.ts` fala com o
 * banco, e `canProcess()` — a regra em si — já tem os próprios testes em
 * `packages/core`.
 */
describe("início do mês, no horário de Brasília", () => {
  it("devolve o dia 1 às 00:00 de Brasília, expresso em UTC", () => {
    expect(inicioDoMes(new Date("2026-09-22T12:00:00Z")).toISOString()).toBe(
      "2026-09-01T03:00:00.000Z",
    );
  });

  /**
   * A razão de esta função existir. Às 22h do dia 30, em Brasília, já é dia 1
   * em UTC: contar pelo mês UTC jogaria essa consulta para a quota do mês
   * seguinte, e num plano de 300 minutos isso é uma consulta inteira no lado
   * errado da conta.
   */
  it("mantém no mês corrente a consulta gravada às 22h do último dia", () => {
    // 30/09 22:00 em Brasília = 01/10 01:00 em UTC.
    const gravadaTarde = new Date("2026-10-01T01:00:00Z");
    expect(inicioDoMes(gravadaTarde).toISOString()).toBe("2026-09-01T03:00:00.000Z");
  });

  it("vira o mês na hora certa", () => {
    // 01/10 00:00 em Brasília = 01/10 03:00 em UTC.
    expect(inicioDoMes(new Date("2026-10-01T03:00:00Z")).toISOString()).toBe(
      "2026-10-01T03:00:00.000Z",
    );
    expect(inicioDoMes(new Date("2026-10-01T02:59:59Z")).toISOString()).toBe(
      "2026-09-01T03:00:00.000Z",
    );
  });

  it("atravessa a virada do ano", () => {
    expect(inicioDoMes(new Date("2027-01-01T05:00:00Z")).toISOString()).toBe(
      "2027-01-01T03:00:00.000Z",
    );
    expect(inicioDoMes(new Date("2027-01-01T02:00:00Z")).toISOString()).toBe(
      "2026-12-01T03:00:00.000Z",
    );
  });
});
