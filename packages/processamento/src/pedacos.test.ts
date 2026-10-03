import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStorage, type AudioStorage } from "@scribe/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { juntarPedacos } from "./pedacos";

let raiz: string;
let storage: AudioStorage;
const bytes = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
const pedaco = (i: number) => `p/partes/s/${String(i).padStart(5, "0")}`;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "scribe-pedacos-"));
  storage = createLocalStorage(raiz);
});
afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("juntarPedacos", () => {
  it("junta em ordem de índice", async () => {
    await storage.put(
      "p/s.partes.json",
      bytes(JSON.stringify({ partes: 3, extensao: "wav" })),
    );
    await storage.put(pedaco(2), bytes("C"));
    await storage.put(pedaco(0), bytes("A"));
    await storage.put(pedaco(1), bytes("B"));
    const r = await juntarPedacos(storage, "p/s.partes.json", pedaco);
    expect(r.ok && new TextDecoder().decode(r.bytes)).toBe("ABC");
    expect(r.ok && r.manifesto).toEqual({ partes: 3, extensao: "wav" });
  });

  // Um buraco no meio seria um trecho da consulta ausente da nota, sem erro.
  it("pedaço que não existe é consulta incompleta, dita com o número", async () => {
    await storage.put(
      "p/s.partes.json",
      bytes(JSON.stringify({ partes: 3, extensao: "wav" })),
    );
    await storage.put(pedaco(0), bytes("A"));
    await storage.put(pedaco(2), bytes("C"));
    const r = await juntarPedacos(storage, "p/s.partes.json", pedaco);
    expect(r).toEqual({ ok: false, motivo: "falta o pedaço 2 de 3 da gravação" });
  });

  it("manifesto ilegível ou fora dos limites é recusado", async () => {
    for (const ruim of [
      "não é json",
      '{"partes":0,"extensao":"wav"}',
      '{"partes":3,"extensao":"../x"}',
    ]) {
      await storage.put("p/s.partes.json", bytes(ruim));
      const r = await juntarPedacos(storage, "p/s.partes.json", pedaco);
      expect(r.ok).toBe(false);
    }
  });
});
