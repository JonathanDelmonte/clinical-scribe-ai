import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { agente, semCorteDoUndici } from "./index";

/**
 * Um motor que demora a responder — como a transcrição de uma consulta longa,
 * que só devolve o cabeçalho quando termina.
 */
let servidor: Server;
let url: string;
beforeAll(async () => {
  servidor = createServer((_pedido, resposta) => {
    setTimeout(() => resposta.end("pronto"), 1500);
  });
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/`;
});
afterAll(() => new Promise<void>((fim) => servidor.close(() => fim())));

describe("as chamadas ao motor e o corte do undici", () => {
  // O controle: se o `fetch` do Node ignorasse o agente do pacote, este
  // corte de 300 ms não aconteceria — e o agente sem corte não provaria nada.
  it("o fetch do Node obedece ao agente do pacote undici", async () => {
    await expect(
      fetch(url, { dispatcher: agente({ headersTimeout: 300 }) } as RequestInit),
    ).rejects.toThrow(/fetch failed/);
  });

  it("sem o corte, espera o motor responder", async () => {
    const res = await fetch(url, { dispatcher: semCorteDoUndici } as RequestInit);
    expect(await res.text()).toBe("pronto");
  });
});
