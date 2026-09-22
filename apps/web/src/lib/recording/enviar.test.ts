import { describe, expect, it, vi } from "vitest";

import { enviarEmPartes, EnvioInterrompido } from "./enviar";

const SESSAO = "sessao-1";
const arquivo = () => new Blob([new Uint8Array(250)]);

/** Nunca espera de verdade: o teste não pode levar oito segundos. */
const dormir = () => Promise.resolve();
const semRuido = () => 0.5;

function servidor(opcoes: {
  partesJaRecebidas?: number[];
  falharNoIndice?: { indice: number; vezes: number; status?: number };
}) {
  const recebidas: number[] = [...(opcoes.partesJaRecebidas ?? [])];
  const chamadas: string[] = [];
  let falhasRestantes = opcoes.falharNoIndice?.vezes ?? 0;

  const impl = vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada);
    chamadas.push(`${init?.method ?? "GET"} ${url}`);

    if ((init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ partes: recebidas }), { status: 200 });
    }

    const indice = Number(url.split("/").pop());
    if (opcoes.falharNoIndice?.indice === indice && falhasRestantes > 0) {
      falhasRestantes -= 1;
      const status = opcoes.falharNoIndice.status ?? 503;
      if (status === 0) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ error: "recusado" }), { status });
    }

    recebidas.push(indice);
    return new Response(null, { status: 204 });
  });

  return { impl: impl as unknown as typeof fetch, chamadas, recebidas };
}

describe("envio em partes", () => {
  it("sobe todas as partes e devolve quantas são", async () => {
    const s = servidor({});
    const total = await enviarEmPartes({
      sessionId: SESSAO,
      arquivo: arquivo(),
      tamanhoDaParte: 100,
      fetchImpl: s.impl,
      dormir,
      aleatorio: semRuido,
    });

    expect(total).toBe(3);
    expect(s.recebidas.sort()).toEqual([0, 1, 2]);
  });

  /**
   * A razão de tudo isto existir: numa segunda tentativa o cliente não sabe o
   * que já subiu — só o servidor sabe. Sem perguntar, uma consulta que falhou
   * aos 90% recomeçaria do zero pela mesma rede que a derrubou.
   */
  it("pergunta o que já chegou e sobe apenas o que falta", async () => {
    const s = servidor({ partesJaRecebidas: [0, 1] });
    await enviarEmPartes({
      sessionId: SESSAO,
      arquivo: arquivo(),
      tamanhoDaParte: 100,
      fetchImpl: s.impl,
      dormir,
      aleatorio: semRuido,
    });

    expect(s.chamadas.filter((c) => c.startsWith("PUT"))).toEqual([
      `PUT /api/sessions/${SESSAO}/audio/partes/2`,
    ]);
  });

  it("tenta de novo depois de erro de servidor, e segue em frente", async () => {
    const s = servidor({ falharNoIndice: { indice: 1, vezes: 2, status: 503 } });
    await enviarEmPartes({
      sessionId: SESSAO,
      arquivo: arquivo(),
      tamanhoDaParte: 100,
      fetchImpl: s.impl,
      dormir,
      aleatorio: semRuido,
    });

    expect(s.recebidas.sort()).toEqual([0, 1, 2]);
  });

  it("tenta de novo quando a rede simplesmente cai", async () => {
    const s = servidor({ falharNoIndice: { indice: 0, vezes: 3, status: 0 } });
    await enviarEmPartes({
      sessionId: SESSAO,
      arquivo: arquivo(),
      tamanhoDaParte: 100,
      fetchImpl: s.impl,
      dormir,
      aleatorio: semRuido,
    });

    expect(s.recebidas.sort()).toEqual([0, 1, 2]);
  });

  it("desiste depois do limite, dizendo o que já subiu", async () => {
    const s = servidor({ falharNoIndice: { indice: 1, vezes: 99, status: 503 } });

    await expect(
      enviarEmPartes({
        sessionId: SESSAO,
        arquivo: arquivo(),
        tamanhoDaParte: 100,
        maxTentativas: 3,
        fetchImpl: s.impl,
        dormir,
        aleatorio: semRuido,
      }),
    ).rejects.toBeInstanceOf(EnvioInterrompido);

    // A parte 0 subiu antes da falha, e é isso que a retomada aproveita.
    expect(s.recebidas).toEqual([0]);
  });

  /**
   * 4xx não é problema de rede: repetir quatro vezes um pedido errado só
   * atrasa a mensagem que a pessoa precisa ler.
   */
  it("não insiste em erro do cliente", async () => {
    const s = servidor({ falharNoIndice: { indice: 0, vezes: 99, status: 415 } });

    await expect(
      enviarEmPartes({
        sessionId: SESSAO,
        arquivo: arquivo(),
        tamanhoDaParte: 100,
        fetchImpl: s.impl,
        dormir,
        aleatorio: semRuido,
      }),
    ).rejects.toThrow(/recusado/);

    expect(s.chamadas.filter((c) => c.includes("PUT"))).toHaveLength(1);
  });

  it("insiste em 429, que pede exatamente isso", async () => {
    const s = servidor({ falharNoIndice: { indice: 0, vezes: 1, status: 429 } });
    await enviarEmPartes({
      sessionId: SESSAO,
      arquivo: arquivo(),
      tamanhoDaParte: 100,
      fetchImpl: s.impl,
      dormir,
      aleatorio: semRuido,
    });
    expect(s.recebidas.sort()).toEqual([0, 1, 2]);
  });

  it("relata o progresso a cada parte", async () => {
    const s = servidor({});
    const progresso: number[] = [];

    await enviarEmPartes({
      sessionId: SESSAO,
      arquivo: arquivo(),
      tamanhoDaParte: 100,
      fetchImpl: s.impl,
      dormir,
      aleatorio: semRuido,
      onProgresso: (p) => progresso.push(p.enviadas),
    });

    expect(progresso).toEqual([0, 1, 2, 3]);
  });

  it("recusa arquivo vazio antes de falar com o servidor", async () => {
    const s = servidor({});
    await expect(
      enviarEmPartes({
        sessionId: SESSAO,
        arquivo: new Blob([]),
        fetchImpl: s.impl,
        dormir,
      }),
    ).rejects.toThrow(/vazio/);
    expect(s.chamadas).toHaveLength(0);
  });
});
