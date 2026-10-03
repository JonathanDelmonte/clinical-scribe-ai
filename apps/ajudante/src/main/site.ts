/**
 * As conversas do ajudante com o site — sempre com o token da conta, nunca
 * com chave de banco ou de armazenamento. Ver ADR-0005.
 */

import type {
  Andamento,
  AvisoDeAudio,
  Entrega,
  Falha,
  OrdemDeServico,
  RespostaDoAudio,
  Sinal,
} from "@scribe/processamento/puro";

import { enderecoDoSite } from "./caminhos";

/** O site não reconhece mais este computador: conecte de novo. */
export class Desconectado extends Error {
  override readonly name = "Desconectado";
}

/** O trabalho não está mais com este computador (a estação assumiu). */
export class TrabalhoPerdido extends Error {
  override readonly name = "TrabalhoPerdido";
}

async function chamar<T>(
  token: string,
  metodo: "POST" | "DELETE",
  caminho: string,
  corpo?: unknown,
): Promise<T | null> {
  const resposta = await fetch(`${enderecoDoSite()}${caminho}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${token}`,
      ...(corpo === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    signal: AbortSignal.timeout(60_000),
  });
  if (resposta.status === 204) return null;
  const lido = (await resposta.json().catch(() => null)) as
    (T & { erro?: string }) | null;
  if (resposta.status === 401) throw new Desconectado(lido?.erro ?? "desconectado");
  if (resposta.status === 409)
    throw new TrabalhoPerdido(lido?.erro ?? "trabalho perdido");
  if (!resposta.ok) {
    throw new Error(`o site respondeu ${resposta.status}: ${lido?.erro ?? ""}`.trim());
  }
  return lido;
}

export function criarSite(token: string) {
  const tarefa = (id: string, etapa: string) => `/api/ajudante/tarefas/${id}/${etapa}`;
  return {
    sinal: (sinal: Sinal) =>
      chamar<{ profissional: string; computador: string }>(
        token,
        "POST",
        "/api/ajudante/sinal",
        sinal,
      ),
    pegar: () => chamar<OrdemDeServico>(token, "POST", "/api/ajudante/tarefas"),
    andamento: (id: string, andamento: Andamento) =>
      chamar<{ ok: true }>(token, "POST", tarefa(id, "andamento"), andamento),
    audio: async (id: string, aviso: AvisoDeAudio) =>
      (await chamar<RespostaDoAudio>(token, "POST", tarefa(id, "audio"), aviso)) ?? {
        seguir: false,
      },
    entregar: (id: string, entrega: Entrega) =>
      chamar<{ ok: true }>(token, "POST", tarefa(id, "entrega"), entrega),
    falhar: (id: string, falha: Falha) =>
      chamar<{ ok: true }>(token, "POST", tarefa(id, "falha"), falha),
    desconectar: () => chamar<{ ok: true }>(token, "DELETE", "/api/ajudante/conta"),
  };
}

export type Site = ReturnType<typeof criarSite>;
