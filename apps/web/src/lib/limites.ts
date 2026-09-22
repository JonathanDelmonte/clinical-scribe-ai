import "server-only";

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { currentProfessional } from "./auth";
import { Limitador, POLITICAS, type Politica } from "./rate-limit";

/**
 * Onde os limitadores vivem, e como as rotas os usam.
 *
 * Um limitador por política, guardado no escopo global do módulo. Em
 * desenvolvimento o Next recarrega módulos a cada arquivo salvo, e sem o cache
 * global cada recarga criaria baldes novos — o limite existiria no código e
 * não no comportamento, que é a pior forma de ter um limite.
 */

const globalParaLimites = globalThis as unknown as {
  scribeLimitadores?: Map<string, Limitador>;
};

const limitadores = (globalParaLimites.scribeLimitadores ??= new Map());

function limitador(nome: string, politica: Politica): Limitador {
  let existente = limitadores.get(nome);
  if (existente === undefined) {
    existente = new Limitador(politica);
    limitadores.set(nome, existente);
  }
  return existente;
}

/**
 * Varre os baldes cheios de tempos em tempos.
 *
 * `unref()` para que este temporizador não segure o processo vivo no
 * desligamento — um `setInterval` sem ele transforma `SIGTERM` em espera de
 * cinco minutos.
 */
const globalParaLimpeza = globalThis as unknown as { scribeLimpezaLimites?: boolean };
if (globalParaLimpeza.scribeLimpezaLimites !== true) {
  globalParaLimpeza.scribeLimpezaLimites = true;
  setInterval(() => {
    for (const l of limitadores.values()) l.limpar();
  }, 5 * 60_000).unref();
}

/**
 * De onde veio a requisição.
 *
 * ⚠️ `x-forwarded-for` é um cabeçalho, e cabeçalho vem do cliente. Atrás de um
 * proxy confiável ele é verdade; exposto direto à internet, qualquer um
 * escreve o que quiser nele e escapa de um limite por IP trocando o valor a
 * cada tentativa.
 *
 * Isso é aceitável aqui porque o limite por IP é a **segunda** linha: o login
 * também é limitado por e-mail, que o atacante não pode variar se quer entrar
 * numa conta específica. Na hora de expor isto à internet, o proxy na frente
 * precisa sobrescrever o cabeçalho — está no checklist de segurança.
 */
export async function origemDaRequisicao(): Promise<string> {
  try {
    const h = await headers();
    const encaminhado = h.get("x-forwarded-for")?.split(",")[0];
    return (encaminhado ?? h.get("x-real-ip") ?? "desconhecido").trim().slice(0, 64);
  } catch {
    return "desconhecido";
  }
}

export interface Limite {
  readonly nome: keyof typeof POLITICAS;
  /** O que está sendo contado: um IP, um e-mail, um ID de profissional. */
  readonly chave: string;
}

/**
 * Aplica o limite. Devolve uma resposta 429 quando estourou, ou `null`.
 *
 * O padrão de uso é `const barrado = aplicarLimite(...); if (barrado !== null)
 * return barrado;` — um `if` no topo da rota, visível, sem envolver o handler
 * numa camada de indireção que esconde qual limite vale para qual rota.
 */
export function aplicarLimite(limite: Limite): NextResponse | null {
  const veredito = limitador(limite.nome, POLITICAS[limite.nome]).consumir(
    `${limite.nome}:${limite.chave}`,
  );

  if (veredito.permitido) return null;

  return NextResponse.json(
    {
      error:
        `Muitas tentativas. Aguarde ${veredito.esperarSegundos} ` +
        `${veredito.esperarSegundos === 1 ? "segundo" : "segundos"} e tente de novo.`,
    },
    {
      status: 429,
      // `Retry-After` é o cabeçalho padrão para isto, e é o que faz um cliente
      // bem-comportado esperar em vez de insistir.
      headers: { "retry-after": String(veredito.esperarSegundos) },
    },
  );
}

/** Aplica vários limites; o primeiro que barrar responde. */
export function aplicarLimites(...limites: Limite[]): NextResponse | null {
  for (const limite of limites) {
    const barrado = aplicarLimite(limite);
    if (barrado !== null) return barrado;
  }
  return null;
}

/**
 * Limita uma rota autenticada, contando por profissional.
 *
 * Por profissional e não por IP: o consultório inteiro sai de um IP só, e o
 * que se quer limitar é quem consome — não quem compartilha a rede. Sem sessão
 * resolvida, cai no IP, que é a única chave que existe naquele momento.
 */
export async function limitarPorProfissional(
  nome: keyof typeof POLITICAS,
): Promise<NextResponse | null> {
  const me = await currentProfessional().catch(() => null);
  const chave = me?.id ?? `ip:${await origemDaRequisicao()}`;
  return aplicarLimite({ nome, chave });
}
