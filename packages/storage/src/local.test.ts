import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  extensionOf,
  professionalFileKey,
  sessionAudioKey,
  sessionPartKey,
  sessionPartsPrefix,
  type AudioStorage,
} from "./index";
import { createLocalStorage } from "./local";

let root: string;
let storage: AudioStorage;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scribe-storage-"));
  storage = createLocalStorage(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const bytes = (s: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;

describe("armazenamento local", () => {
  it("grava e lê de volta os mesmos bytes", async () => {
    await storage.put("prof-1/sess-1.wav", bytes("audio"));
    const read = await storage.get("prof-1/sess-1.wav");
    expect(new TextDecoder().decode(read)).toBe("audio");
  });

  it("cria os diretórios intermediários sozinho", async () => {
    await storage.put("a/b/c/d.wav", bytes("x"));
    expect(await storage.exists("a/b/c/d.wav")).toBe(true);
  });

  it("exists devolve false para chave inexistente", async () => {
    expect(await storage.exists("prof-1/nao-existe.wav")).toBe(false);
  });

  it("remove apaga, e apagar duas vezes não quebra", async () => {
    await storage.put("prof-1/tmp.wav", bytes("x"));
    await storage.remove("prof-1/tmp.wav");
    await storage.remove("prof-1/tmp.wav");
    expect(await storage.exists("prof-1/tmp.wav")).toBe(false);
  });
});

describe("listagem por prefixo", () => {
  it("devolve lista vazia para prefixo que não existe", async () => {
    expect(await storage.list("prof-9/partes/inexistente")).toEqual([]);
  });

  it("devolve as chaves sob o prefixo, e só elas", async () => {
    await storage.put("prof-2/partes/s1/00000", bytes("a"));
    await storage.put("prof-2/partes/s1/00001", bytes("b"));
    await storage.put("prof-2/partes/s2/00000", bytes("c"));

    expect(await storage.list("prof-2/partes/s1")).toEqual([
      "prof-2/partes/s1/00000",
      "prof-2/partes/s1/00001",
    ]);
  });

  /**
   * É por isto que o índice leva zeros à esquerda: a ordem da listagem é a
   * ordem em que os pedaços voltam a ser um áudio. Com "2" e "10" crus, o
   * décimo pedaço entraria antes do segundo e a consulta remontada teria o
   * meio fora de lugar — sem erro nenhum, só um áudio errado.
   */
  it("ordena o pedaço 10 depois do pedaço 2", async () => {
    for (const i of [2, 10, 1]) {
      await storage.put(sessionPartKey("prof-3", "s1", i), bytes(String(i)));
    }
    expect(await storage.list(sessionPartsPrefix("prof-3", "s1"))).toEqual([
      "prof-3/partes/s1/00001",
      "prof-3/partes/s1/00002",
      "prof-3/partes/s1/00010",
    ]);
  });
});

describe("travessia de caminho", () => {
  // A chave é composta com dados que vieram do navegador. Se `../` passar,
  // um upload consegue escrever em qualquer lugar do disco do servidor.
  it.each(["../fora.wav", "prof-1/../../fora.wav", "prof-1/../../../etc/passwd"])(
    "recusa a chave %s",
    async (key) => {
      await expect(storage.put(key, bytes("x"))).rejects.toThrow(/inválida/);
    },
  );

  it("recusa também na leitura, não só na escrita", async () => {
    await expect(storage.get("../fora.wav")).rejects.toThrow(/inválida/);
  });

  it("aceita chave que só PARECE sair da raiz", async () => {
    // "prof-1/../prof-2/x.wav" resolve para dentro da raiz — é válida.
    await expect(
      storage.put("prof-1/../prof-2/x.wav", bytes("x")),
    ).resolves.toBeUndefined();
  });
});

describe("convenção de chave", () => {
  it("põe o dono primeiro no caminho", () => {
    expect(sessionAudioKey("prof-1", "sess-9", "wav")).toBe("prof-1/sess-9.wav");
  });

  it("aceita extensão com ou sem ponto, e normaliza", () => {
    expect(sessionAudioKey("p", "s", ".WAV")).toBe("p/s.wav");
  });

  it("põe o dono primeiro também nos arquivos de perfil", () => {
    expect(professionalFileKey("prof-1", "assinatura.png")).toBe(
      "prof-1/perfil/assinatura.png",
    );
  });

  // O nome do arquivo de perfil entra na composição da chave, então precisa
  // ser recusado ANTES de virar caminho — a defesa de `pathFor` é a segunda
  // linha, não a única.
  it.each(["../fora", "a/b", "assinatura.png ", ""])(
    "recusa o nome de arquivo de perfil %s",
    (nome) => {
      expect(() => professionalFileKey("prof-1", nome)).toThrow(/inválido/);
    },
  );

  it.each([
    ["gravacao.webm", "webm"],
    ["consulta.WAV", "wav"],
    ["audio.m4a", "m4a"],
    ["sem-extensao", "webm"],
  ])("extensionOf(%s) = %s", (filename, expected) => {
    expect(extensionOf(filename)).toBe(expected);
  });
});
