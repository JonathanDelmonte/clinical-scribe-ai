import "server-only";

import type { Registro } from "@scribe/processamento";

/**
 * O registro das etapas conduzidas em nome do ajudante.
 *
 * As etapas (`@scribe/processamento`) já só registram IDs e sinais — nunca o
 * que foi dito na consulta. Aqui, avisos e erros vão para o log da função (o
 * da Vercel, em produção) como uma linha de JSON; o informativo fica de fora,
 * para o log da função não virar o diário de cada consulta.
 */
export function registroDoAjudante(contexto: Record<string, unknown>): Registro {
  const escrever = (nivel: string, dados: object, mensagem: string) => {
    console.error(JSON.stringify({ nivel, ...contexto, ...semErro(dados), mensagem }));
  };
  return {
    info: () => undefined,
    warn: (dados, mensagem) => escrever("aviso", dados, mensagem),
    error: (dados, mensagem) => escrever("erro", dados, mensagem),
  };
}

/** Um `Error` vira só a mensagem — `JSON.stringify` o transformaria em `{}`. */
function semErro(dados: object): object {
  const err = (dados as { err?: unknown }).err;
  return err instanceof Error ? { ...dados, err: err.message } : dados;
}
