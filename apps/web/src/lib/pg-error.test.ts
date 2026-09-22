import { describe, expect, it } from "vitest";

import { codigoPostgres, UNIQUE_VIOLATION } from "./pg-error";

describe("código SQLSTATE", () => {
  it("lê o código do próprio erro", () => {
    expect(codigoPostgres(Object.assign(new Error("x"), { code: "23505" }))).toBe(
      UNIQUE_VIOLATION,
    );
  });

  /**
   * O caso real, e a razão de esta função existir: o driver lança o erro do
   * Postgres, o Drizzle o embrulha ao desfazer a transação, e o `catch` recebe
   * um `Error` genérico com o original em `cause`.
   */
  it("atravessa o embrulho da transação", () => {
    const original = Object.assign(new Error("duplicate key"), { code: "23505" });
    const embrulhado = new Error("Failed query", { cause: original });
    expect(codigoPostgres(embrulhado)).toBe(UNIQUE_VIOLATION);
  });

  it("atravessa mais de um nível", () => {
    const original = Object.assign(new Error("x"), { code: "23503" });
    const dois = new Error("a", { cause: new Error("b", { cause: original }) });
    expect(codigoPostgres(dois)).toBe("23503");
  });

  it("para na profundidade máxima em vez de percorrer um ciclo", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(codigoPostgres(a)).toBeNull();
  });

  /**
   * Um `code` de erro de sistema viaja na mesma propriedade quando o banco
   * está fora do ar. Confundi-lo com um SQLSTATE faria "servidor inacessível"
   * ser respondido como "e-mail já cadastrado".
   */
  it("ignora código de erro de sistema", () => {
    expect(codigoPostgres({ code: "ECONNREFUSED" })).toBeNull();
    expect(codigoPostgres({ code: "ENOTFOUND" })).toBeNull();
  });

  it("devolve null para o que não é erro", () => {
    expect(codigoPostgres(null)).toBeNull();
    expect(codigoPostgres(undefined)).toBeNull();
    expect(codigoPostgres("erro")).toBeNull();
    expect(codigoPostgres(new Error("sem código"))).toBeNull();
  });
});
