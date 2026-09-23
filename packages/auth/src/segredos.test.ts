import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cifrar,
  cofreDisponivel,
  decifrar,
  dicaDaChave,
  mesmoSegredo,
  SegredoIndisponivel,
} from "./segredos";

const CHAVE = randomBytes(32).toString("base64");
const OUTRA = randomBytes(32).toString("base64");
const EXEMPLO = "sk-ant-api03-exemplo-de-chave-que-nao-existe-7f3a";

let anterior: string | undefined;

beforeEach(() => {
  anterior = process.env["SEGREDO_MESTRE"];
  process.env["SEGREDO_MESTRE"] = CHAVE;
});
afterEach(() => {
  if (anterior === undefined) delete process.env["SEGREDO_MESTRE"];
  else process.env["SEGREDO_MESTRE"] = anterior;
});

describe("cifrar e decifrar", () => {
  it("devolve o mesmo texto do outro lado", () => {
    expect(decifrar(cifrar(EXEMPLO))).toBe(EXEMPLO);
  });

  it("o texto cifrado não contém a chave", () => {
    expect(cifrar(EXEMPLO)).not.toContain("7f3a");
    expect(cifrar(EXEMPLO)).not.toContain("sk-ant");
  });

  // Cifrar duas vezes precisa dar resultados diferentes. Se desse o mesmo,
  // quem visse o banco saberia que dois profissionais usam a MESMA chave —
  // e, pior, notaria quando alguém troca a sua.
  it("cifrar duas vezes dá textos diferentes", () => {
    expect(cifrar(EXEMPLO)).not.toBe(cifrar(EXEMPLO));
  });

  it("aguenta acentos e emoji", () => {
    const esquisito = "chave-com-çãü-e-🔑";
    expect(decifrar(cifrar(esquisito))).toBe(esquisito);
  });

  it("aguenta texto vazio", () => {
    expect(decifrar(cifrar(""))).toBe("");
  });
});

describe("integridade", () => {
  // O motivo de usar GCM. Sem autenticação, alterar bytes no banco produziria
  // lixo que o código trataria como chave válida e mandaria ao fornecedor.
  it("recusa texto cifrado adulterado", () => {
    const cofre = cifrar(EXEMPLO);
    const partes = cofre.split(".");
    const dados = Buffer.from(partes[3]!, "base64");
    dados[0] = (dados[0]! ^ 0xff) & 0xff;
    partes[3] = dados.toString("base64");
    expect(() => decifrar(partes.join("."))).toThrow(SegredoIndisponivel);
  });

  it("recusa etiqueta de autenticação trocada", () => {
    const partes = cifrar(EXEMPLO).split(".");
    partes[2] = randomBytes(16).toString("base64");
    expect(() => decifrar(partes.join("."))).toThrow(SegredoIndisponivel);
  });

  it("recusa formato desconhecido", () => {
    expect(() => decifrar("só um texto")).toThrow(SegredoIndisponivel);
    expect(() => decifrar("v9.a.b.c")).toThrow(SegredoIndisponivel);
  });

  // A propriedade que faz o cofre valer a pena: o banco sozinho não abre nada.
  it("outra chave mestra não abre o segredo", () => {
    const cofre = cifrar(EXEMPLO);
    process.env["SEGREDO_MESTRE"] = OUTRA;
    expect(() => decifrar(cofre)).toThrow(SegredoIndisponivel);
  });
});

describe("configuração", () => {
  it("sem chave mestra, avisa como gerar uma", () => {
    delete process.env["SEGREDO_MESTRE"];
    expect(() => cifrar("x")).toThrow(/SEGREDO_MESTRE/);
    expect(cofreDisponivel()).toBe(false);
  });

  it("chave mestra do tamanho errado é recusada", () => {
    process.env["SEGREDO_MESTRE"] = Buffer.from("curta").toString("base64");
    expect(() => cifrar("x")).toThrow(/32 bytes/);
  });

  it("com chave mestra válida, o cofre está disponível", () => {
    expect(cofreDisponivel()).toBe(true);
  });
});

describe("dicaDaChave", () => {
  it("mostra só os últimos quatro caracteres", () => {
    expect(dicaDaChave(EXEMPLO)).toBe("••••7f3a");
  });

  it("não vaza nada de uma chave curta", () => {
    expect(dicaDaChave("abc")).toBe("••••");
  });
});

describe("mesmoSegredo", () => {
  it("reconhece iguais e diferentes", () => {
    expect(mesmoSegredo("abc", "abc")).toBe(true);
    expect(mesmoSegredo("abc", "abd")).toBe(false);
    expect(mesmoSegredo("abc", "abcd")).toBe(false);
  });
});
