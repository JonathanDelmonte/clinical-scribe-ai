import "server-only";

import { patients, sessions, usageEvents } from "@scribe/db";
import { and, desc, eq, gte, sql, sum } from "drizzle-orm";

import type { Tx } from "./auth";
import { inicioDoMes } from "./quota";

/**
 * O que o produto gastou, e em quê.
 *
 * A §11 do plano de desenvolvimento é direta: **medir o custo por consulta
 * desde o primeiro usuário.** O motivo é que o plano grátis é a estratégia de
 * aquisição inteira, e um plano grátis cujo custo ninguém acompanha sangra
 * caixa por meses antes de alguém perceber.
 *
 * A tabela `usage_events` já recebe escrita do worker desde o Marco 4. O que
 * faltava era a tela — e uma instrumentação que ninguém lê é uma instrumentação
 * que não existe.
 */

/** Os tipos que o worker registra hoje, e como eles aparecem na tela. */
export const ROTULO_DE_TIPO: Record<string, string> = {
  asr: "transcrição",
  llm_note: "nota clínica",
  llm_objective: "documentos do objetivo",
  llm_verify: "conferência de citações",
  storage: "armazenamento",
};

export function rotuloDeTipo(kind: string): string {
  return ROTULO_DE_TIPO[kind] ?? kind;
}

/**
 * Centavos de real como texto.
 *
 * Inteiro em centavos, e não `number` em reais, em todo o caminho — é a mesma
 * razão de sempre: 0,1 + 0,2 não é 0,3 em ponto flutuante, e um relatório de
 * custo que não fecha por um centavo é um relatório em que ninguém confia.
 */
export function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatarMinutos(minutos: number): string {
  if (minutos < 1) return "menos de 1 min";
  return `${Math.round(minutos)} min`;
}

/** "setembro de 2026", a partir do primeiro instante do mês. */
export function nomeDoMes(inicio: Date): string {
  return inicio.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

export interface LinhaPorTipo {
  readonly kind: string;
  readonly minutos: number;
  readonly centavos: number;
  readonly eventos: number;
}

/** O consumo do mês, quebrado por tipo de evento. */
export async function usoPorTipo(
  tx: Tx,
  agora: Date = new Date(),
): Promise<LinhaPorTipo[]> {
  const linhas = await tx
    .select({
      kind: usageEvents.kind,
      minutos: sum(usageEvents.minutes),
      centavos: sum(usageEvents.costCents),
      eventos: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, inicioDoMes(agora)))
    .groupBy(usageEvents.kind)
    .orderBy(desc(sum(usageEvents.costCents)));

  return linhas.map((l) => ({
    kind: l.kind,
    minutos: Number(l.minutos ?? 0),
    centavos: Number(l.centavos ?? 0),
    eventos: l.eventos,
  }));
}

export interface LinhaPorSessao {
  readonly sessionId: string | null;
  readonly paciente: string | null;
  readonly quando: Date;
  readonly minutos: number;
  readonly centavos: number;
}

/**
 * O custo de cada consulta do mês.
 *
 * É a linha que a §11 chama de "economia unitária": quanto uma consulta custa
 * de verdade, medido, e não estimado a partir da tabela de preços de alguém.
 * Sem ela, o preço do plano Pro é chute.
 */
export async function usoPorSessao(
  tx: Tx,
  agora: Date = new Date(),
  limite = 50,
): Promise<LinhaPorSessao[]> {
  const linhas = await tx
    .select({
      sessionId: usageEvents.sessionId,
      paciente: patients.name,
      quando: sql<Date>`max(${usageEvents.createdAt})`,
      minutos: sum(usageEvents.minutes),
      centavos: sum(usageEvents.costCents),
    })
    .from(usageEvents)
    .leftJoin(sessions, eq(sessions.id, usageEvents.sessionId))
    .leftJoin(patients, eq(patients.id, sessions.patientId))
    .where(gte(usageEvents.createdAt, inicioDoMes(agora)))
    .groupBy(usageEvents.sessionId, patients.name)
    .orderBy(desc(sql`max(${usageEvents.createdAt})`))
    .limit(limite);

  return linhas.map((l) => ({
    sessionId: l.sessionId,
    paciente: l.paciente,
    quando: new Date(l.quando),
    minutos: Number(l.minutos ?? 0),
    centavos: Number(l.centavos ?? 0),
  }));
}

export interface LinhaPorMes {
  readonly inicio: Date;
  readonly minutos: number;
  readonly centavos: number;
  readonly sessoes: number;
}

/**
 * Os últimos meses, para ver a tendência.
 *
 * `date_trunc` no fuso de São Paulo, e não em UTC, pelo mesmo motivo de
 * `inicioDoMes`: três horas de diferença jogam a última consulta de cada mês
 * para o mês seguinte.
 */
export async function usoPorMes(tx: Tx, meses = 6): Promise<LinhaPorMes[]> {
  const linhas = await tx
    .select({
      inicio: sql<string>`date_trunc('month', ${usageEvents.createdAt} at time zone 'America/Sao_Paulo')`,
      minutos: sum(usageEvents.minutes),
      centavos: sum(usageEvents.costCents),
      sessoes: sql<number>`count(distinct ${usageEvents.sessionId})::int`,
    })
    .from(usageEvents)
    .groupBy(
      sql`date_trunc('month', ${usageEvents.createdAt} at time zone 'America/Sao_Paulo')`,
    )
    .orderBy(
      desc(
        sql`date_trunc('month', ${usageEvents.createdAt} at time zone 'America/Sao_Paulo')`,
      ),
    )
    .limit(meses);

  return linhas.map((l) => ({
    // O `date_trunc` devolve um carimbo sem fuso já em horário de Brasília;
    // o `-03:00` explícito o recoloca na linha do tempo real.
    inicio: new Date(`${String(l.inicio).replace(" ", "T").slice(0, 19)}-03:00`),
    minutos: Number(l.minutos ?? 0),
    centavos: Number(l.centavos ?? 0),
    sessoes: l.sessoes,
  }));
}

/** Total de eventos já registrados — distingue "custo zero" de "sem dados". */
export async function totalDeEventos(tx: Tx): Promise<number> {
  const [linha] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(and());
  return linha?.n ?? 0;
}
