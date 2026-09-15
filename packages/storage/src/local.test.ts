import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { extensionOf, sessionAudioKey, type AudioStorage } from "./index";
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

  it.each([
    ["gravacao.webm", "webm"],
    ["consulta.WAV", "wav"],
    ["audio.m4a", "m4a"],
    ["sem-extensao", "webm"],
  ])("extensionOf(%s) = %s", (filename, expected) => {
    expect(extensionOf(filename)).toBe(expected);
  });
});
