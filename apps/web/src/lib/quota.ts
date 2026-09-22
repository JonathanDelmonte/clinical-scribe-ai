import "server-only";

import { canProcess, remainingMinutes, type Account } from "@scribe/core";
import { usageEvents } from "@scribe/db";
import { and, gte, sum } from "drizzle-orm";

import type { Tx } from "./auth";

/**
 * Quanto do plano já foi gasto no mês — e se a próxima sessão cabe.
 *
 * `canProcess()` e `remainingMinutes()` já existem em
 * `packages/core/src/account.ts`, prontos e testados, desde o Marco 0. O que
 * faltava era **alguém chamá-los**. Este arquivo é essa chamada, e o lugar em
 * que ela acontece é a rota de upload, ANTES de enfileirar o trabalho —
 * verificar depois é descobrir que estourou quando o custo já foi gasto.
 */

/**
 * O primeiro instante do mês corrente, no horário de Brasília.
 *
 * Usar o mês em UTC pareceria mais simples e erraria em três horas: a quota
 * viraria às 21h do último dia do mês, e uma consulta gravada às 22h contaria
 * para o mês seguinte. Num plano de 300 minutos, isso é uma consulta inteira
 * caindo do lado errado da conta.
 *
 * O deslocamento é fixo em −03:00: o Brasil não adota horário de verão desde
 * 2019, e um `Intl.DateTimeFormat` com fuso nomeado custaria mais do que o
 * problema vale enquanto isso for verdade.
 */
const OFFSET_BRASILIA_MS = 3 * 60 * 60 * 1000;

export function inicioDoMes(agora: Date = new Date()): Date {
  const local = new Date(agora.getTime() - OFFSET_BRASILIA_MS);
  const primeiroDiaLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  return new Date(primeiroDiaLocal + OFFSET_BRASILIA_MS);
}

/**
 * Minutos de áudio processados neste mês.
 *
 * Vem de `usage_events`, que o worker escreve com a duração REAL medida no
 * áudio — não do que o dispositivo declarou no upload. É essa a defesa contra
 * um cliente que minta sobre a duração: a mentira passa por uma sessão e é
 * cobrada na seguinte, porque o consumo do mês não depende dele.
 *
 * Sob RLS: a política de `usage_events` já reduz a tabela ao próprio
 * profissional.
 */
export async function minutosUsadosNoMes(tx: Tx, agora: Date = new Date()) {
  const [linha] = await tx
    .select({ total: sum(usageEvents.minutes) })
    .from(usageEvents)
    .where(and(gte(usageEvents.createdAt, inicioDoMes(agora))));

  // `sum` devolve texto (o Postgres soma `real` em `numeric`) e `null` quando
  // não há linha nenhuma — que é o estado do primeiro dia de todo profissional.
  return Number(linha?.total ?? 0);
}

export interface Quota {
  readonly usados: number;
  /** `null` = sem teto (fair use). */
  readonly restantes: number | null;
}

export async function quotaDoMes(
  tx: Tx,
  account: Account,
  agora: Date = new Date(),
): Promise<Quota> {
  const usados = await minutosUsadosNoMes(tx, agora);
  return {
    usados,
    // Desenvolvedor não tem teto, pela mesma razão que `canProcess` o isenta:
    // ficar sem poder testar o produto que se está construindo é uma forma
    // boba de se bloquear.
    restantes:
      account.role === "developer" ? null : remainingMinutes(account.plan, usados),
  };
}

export type VerificacaoDeQuota =
  | { readonly permitido: true; readonly quota: Quota }
  | { readonly permitido: false; readonly motivo: string; readonly quota: Quota };

/**
 * A sessão pode ser processada?
 *
 * `minutosDaSessao` vem do dispositivo. Quando ele não consegue medir — codec
 * que o navegador não decodifica, celular sem memória para o AudioContext — o
 * valor chega nulo, e aí a verificação vira a mais fraca que ainda faz
 * sentido: **a quota já acabou?** Barrar por um número que ninguém mediu seria
 * recusar uma consulta que já aconteceu, com base em suposição.
 */
export async function verificarQuota(
  tx: Tx,
  account: Account,
  minutosDaSessao: number | null,
  agora: Date = new Date(),
): Promise<VerificacaoDeQuota> {
  const quota = await quotaDoMes(tx, account, agora);

  if (quota.restantes === null) return { permitido: true, quota };

  if (minutosDaSessao === null) {
    return quota.restantes > 0
      ? { permitido: true, quota }
      : {
          permitido: false,
          motivo:
            `Quota do plano ${account.plan} esgotada: ${Math.floor(quota.usados)} ` +
            `de ${Math.floor(quota.usados + quota.restantes)} minutos usados neste mês.`,
          quota,
        };
  }

  const decisao = canProcess(account, quota.usados, minutosDaSessao);
  return decisao.allowed
    ? { permitido: true, quota }
    : { permitido: false, motivo: decisao.reason, quota };
}
