import { describe, expect, it } from "vitest";

import {
  hashDeIsca,
  hashPassword,
  senhaInvalida,
  SENHA_MINIMA,
  verifyPassword,
} from "./password";

describe("hash de senha", () => {
  it("confere a senha correta", async () => {
    const hash = await hashPassword("consulta viva 2026");
    await expect(verifyPassword("consulta viva 2026", hash)).resolves.toBe(true);
  });

  it("recusa a senha errada", async () => {
    const hash = await hashPassword("consulta viva 2026");
    await expect(verifyPassword("consulta viva 2027", hash)).resolves.toBe(false);
  });

  /** Sal por usuário: a mesma senha nunca produz o mesmo registro. */
  it("produz hashes diferentes para a mesma senha", async () => {
    const a = await hashPassword("mesma senha aqui");
    const b = await hashPassword("mesma senha aqui");
    expect(a).not.toEqual(b);
    await expect(verifyPassword("mesma senha aqui", a)).resolves.toBe(true);
    await expect(verifyPassword("mesma senha aqui", b)).resolves.toBe(true);
  });

  it("carrega os parâmetros de custo no próprio registro", async () => {
    const hash = await hashPassword("qualquer senha ok");
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(hash.split("$")).toHaveLength(6);
  });

  /**
   * Um registro corrompido é senha que não confere, nunca exceção: erro 500 no
   * login conta ao visitante que aquela conta existe e está quebrada.
   */
  it("devolve falso para hash malformado em vez de lançar", async () => {
    for (const ruim of [
      "",
      "não é hash",
      "bcrypt$16384$8$1$sal$derivado",
      "scrypt$16384$8$1$sal",
      "scrypt$abc$8$1$c2Fs$ZGVy",
      "scrypt$16384$8$1$$",
    ]) {
      await expect(verifyPassword("qualquer senha ok", ruim)).resolves.toBe(false);
    }
  });

  it("normaliza acentos compostos, para que o teclado não decida o login", async () => {
    // "josé" com É composto (e + acento) contra É pré-composto. São bytes
    // diferentes e a mesma senha para quem digitou.
    const composto = "josé da silva 1";
    const precomposto = "josé da silva 1";
    const hash = await hashPassword(composto);
    await expect(verifyPassword(precomposto, hash)).resolves.toBe(true);
  });

  it("aceita a isca como um hash de verdade que nunca confere", async () => {
    const isca = await hashDeIsca();
    expect(isca.startsWith("scrypt$")).toBe(true);
    await expect(verifyPassword("tentativa qualquer", isca)).resolves.toBe(false);
    // Mesma promessa entre chamadas: derivar uma isca nova por requisição
    // custaria os mesmos 50 ms que ela existe para disfarçar.
    expect(await hashDeIsca()).toBe(isca);
  });
});

describe("regras de senha", () => {
  it("exige comprimento mínimo", () => {
    expect(senhaInvalida("a".repeat(SENHA_MINIMA - 1))).toContain("pelo menos");
    expect(senhaInvalida("a".repeat(SENHA_MINIMA))).toBeNull();
  });

  it("recusa senha absurdamente longa", () => {
    expect(senhaInvalida("a".repeat(5000))).toContain("passa de");
  });
});
