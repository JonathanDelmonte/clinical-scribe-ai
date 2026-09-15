import "server-only";

import { professionals, type Database } from "@scribe/db";
import { cookies } from "next/headers";

import { db, withProfessional } from "./db";

/**
 * Autenticação de DESENVOLVIMENTO.
 *
 * ⚠️ Isto não é login. É um cookie que diz "sou este profissional", sem senha
 * e sem verificação. Existe para fechar o esqueleto andante sem esperar o
 * Supabase Auth, e para tornar visível na tela a diferença entre cargos.
 *
 * O que ele NÃO é: um atalho que contamina o resto. Todas as consultas passam
 * por `withProfessional`, então as políticas RLS valem exatamente como valerão
 * em produção. Quando o Auth real entrar, muda a origem do `authUserId` — o
 * resto do código fica igual.
 *
 * Substituir antes de qualquer usuário real. Ver Marco 5 do plano.
 */
export const DEV_USER_COOKIE = "scribe_dev_user";

/** Profissional no plano grátis — o padrão, para o app abrir no caso comum. */
export const DEV_DEFAULT_AUTH_USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";

export type Professional = typeof professionals.$inferSelect;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function currentAuthUserId(): Promise<string> {
  const store = await cookies();
  return store.get(DEV_USER_COOKIE)?.value ?? DEV_DEFAULT_AUTH_USER_ID;
}

/**
 * O profissional logado.
 *
 * Note que não há filtro `where` aqui: a própria política RLS
 * (`auth_user_id = auth.uid()`) reduz a tabela a uma linha. Se algum dia esta
 * consulta devolver duas, o isolamento está quebrado — e é melhor descobrir
 * assim do que por um `where` que esconderia o problema.
 */
export async function currentProfessional(): Promise<Professional | null> {
  const authUserId = await currentAuthUserId();
  return withProfessional(db, authUserId, async (tx) => {
    const rows = await tx.select().from(professionals).limit(2);
    return rows[0] ?? null;
  });
}

/** Executa uma consulta como o profissional logado, com RLS aplicada. */
export async function asCurrentUser<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const authUserId = await currentAuthUserId();
  return withProfessional(db, authUserId, fn);
}

/** Como `asCurrentUser`, mas entrega também o profissional já carregado. */
export async function asCurrentProfessional<T>(
  fn: (tx: Tx, me: Professional) => Promise<T>,
): Promise<T | null> {
  const authUserId = await currentAuthUserId();
  return withProfessional(db, authUserId, async (tx) => {
    const rows = await tx.select().from(professionals).limit(1);
    const me = rows[0];
    if (me === undefined) return null;
    return fn(tx, me);
  });
}
