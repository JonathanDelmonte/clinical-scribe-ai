import "server-only";

import { professionals, type Database } from "@scribe/db";
import { redirect } from "next/navigation";

import { db, withProfessional } from "./db";
import { lerSessao } from "./auth/session";

/**
 * Quem está usando a aplicação.
 *
 * Isto era, até o Marco 5, um cookie sem senha: qualquer um digitava o UUID de
 * qualquer profissional e virava ele. Era honesto enquanto o objetivo fosse
 * fechar o esqueleto andante, e deixou de ser no instante em que passaram a
 * existir quota, trilha de auditoria e exclusão de conta — os três dizem
 * "quem", e "quem" não pode ser um campo editável.
 *
 * O que mudou foi só a origem do `authUserId`: ele agora vem de um cookie
 * assinado (ver `auth/token.ts`), e tudo abaixo desta linha continua igual —
 * toda consulta passa por `withProfessional`, e as políticas RLS valem como
 * sempre valeram.
 *
 * Esta é a única autoridade sobre identidade na aplicação. O `proxy.ts`
 * confere o mesmo cookie antes, mas para redirecionar quem não entrou; ele é
 * conveniência de navegação, não fronteira de segurança. Uma requisição que
 * chegue aqui sem passar por lá continua sendo barrada.
 */

export type Professional = typeof professionals.$inferSelect;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function currentAuthUserId(): Promise<string | null> {
  return (await lerSessao())?.sub ?? null;
}

/**
 * O profissional logado.
 *
 * Note que não há filtro `where`: a própria política RLS
 * (`auth_user_id = auth.uid()`) reduz a tabela a uma linha. Se algum dia esta
 * consulta devolver duas, o isolamento está quebrado — e é melhor descobrir
 * assim do que por um `where` que esconderia o problema.
 */
export async function currentProfessional(): Promise<Professional | null> {
  const authUserId = await currentAuthUserId();
  if (authUserId === null) return null;

  return withProfessional(db, authUserId, async (tx) => {
    const rows = await tx.select().from(professionals).limit(2);
    return rows[0] ?? null;
  });
}

/** Executa uma consulta como o profissional logado, com RLS aplicada. */
export async function asCurrentUser<T>(fn: (tx: Tx) => Promise<T>): Promise<T | null> {
  const authUserId = await currentAuthUserId();
  if (authUserId === null) return null;
  return withProfessional(db, authUserId, fn);
}

/** Como `asCurrentUser`, mas entrega também o profissional já carregado. */
export async function asCurrentProfessional<T>(
  fn: (tx: Tx, me: Professional) => Promise<T>,
): Promise<T | null> {
  const authUserId = await currentAuthUserId();
  if (authUserId === null) return null;

  return withProfessional(db, authUserId, async (tx) => {
    const rows = await tx.select().from(professionals).limit(1);
    const me = rows[0];
    if (me === undefined) return null;
    return fn(tx, me);
  });
}

/**
 * Para páginas: exige sessão e perfil preenchido, ou manda para onde falta.
 *
 * Três estados, três destinos. O do meio é o que costuma ser esquecido: uma
 * conta recém-criada tem sessão válida e nenhuma especialidade, e cair direto
 * no painel nesse estado produz uma tela vazia que parece defeito.
 */
export async function exigirProfissional(): Promise<Professional> {
  const me = await currentProfessional().catch(() => null);
  if (me === null) redirect("/entrar");
  if (me.onboardedAt === null) redirect("/bem-vindo");
  return me;
}

/** Como `exigirProfissional`, mas aceita o perfil ainda incompleto. */
export async function exigirSessao(): Promise<Professional> {
  const me = await currentProfessional().catch(() => null);
  if (me === null) redirect("/entrar");
  return me;
}
