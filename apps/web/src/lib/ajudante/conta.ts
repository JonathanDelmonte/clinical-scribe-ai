import "server-only";

import { hashDoTokenDoAjudante, pareceTokenDoAjudante } from "@scribe/auth";
import { helpers, professionals, type Database } from "@scribe/db";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "../db";

/**
 * Quem é o ajudante que está chamando — o computador conectado, e de quem.
 *
 * O ajudante não tem cookie: ele manda `Authorization: Bearer <token>`, e o
 * banco guarda só o SHA-256 do token. Ver ADR-0005.
 */
export interface Ajudante {
  readonly id: string;
  readonly professionalId: string;
  readonly authUserId: string;
  /** O nome do computador. */
  readonly nome: string;
  /** De quem é — o ajudante mostra "Conectado como …". */
  readonly profissional: string;
}

/**
 * Uma transação com `service_role` — o papel que IGNORA o isolamento.
 *
 * Por que não deu para fazer sob RLS (a regra do `rls.sql` pede que todo uso
 * diga): o ajudante faz o trabalho do worker, e o que o worker escreve é,
 * por desenho, negado à aplicação — mudar o status de um job, registrar o uso
 * (ver o comentário de `jobs` e `usage_events` em `rls.sql`). E encontrar um
 * ajudante PELO TOKEN acontece antes de saber de quem ele é, como o login.
 *
 * O que compensa a falta da rede de proteção é a disciplina de cada consulta
 * feita aqui dentro: TODA filtra pelo profissional e pelo ajudante já
 * conferidos — o mesmo contrato do worker, que também roda sem RLS.
 */
export async function comoServico<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`set local role service_role`);
    return fn(tx as unknown as Database);
  });
}

/**
 * Confere o token e devolve o ajudante — marcando que ele foi visto agora.
 *
 * Um token com cara errada nem vai ao banco. Um que não existe mais (o
 * computador foi desconectado pelo site) devolve `null`, e o ajudante pede
 * para conectar de novo.
 */
export async function autenticarAjudante(request: Request): Promise<Ajudante | null> {
  const cabecalho = request.headers.get("authorization") ?? "";
  const token = /^Bearer (\S+)$/.exec(cabecalho)?.[1];
  if (token === undefined || !pareceTokenDoAjudante(token)) return null;

  return comoServico(async (tx) => {
    const [linha] = await tx
      .update(helpers)
      .set({ lastSeenAt: new Date() })
      .where(eq(helpers.tokenHash, hashDoTokenDoAjudante(token)))
      .returning({
        id: helpers.id,
        professionalId: helpers.professionalId,
        nome: helpers.name,
      });
    if (linha === undefined) return null;

    const [dono] = await tx
      .select({
        authUserId: professionals.authUserId,
        nome: professionals.name,
        apagadoEm: professionals.deletedAt,
      })
      .from(professionals)
      .where(eq(professionals.id, linha.professionalId))
      .limit(1);
    // Conta excluída: o ajudante não serve mais a ninguém.
    if (dono === undefined || dono.apagadoEm !== null) return null;

    return {
      id: linha.id,
      professionalId: linha.professionalId,
      authUserId: dono.authUserId,
      nome: linha.nome,
      profissional: dono.nome,
    };
  });
}

/** A resposta para um token que não vale: o ajudante mostra "conecte de novo". */
export function ajudanteDesconectado(): NextResponse {
  return NextResponse.json(
    { erro: "Este computador não está mais conectado à conta.", desconectado: true },
    { status: 401 },
  );
}
