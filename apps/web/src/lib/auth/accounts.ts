import "server-only";

import { randomUUID } from "node:crypto";

import { professionals, type Database } from "@scribe/db";
import { eq, sql } from "drizzle-orm";

import { getDb, withProfessional } from "@/lib/db";
import { codigoPostgres, UNIQUE_VIOLATION } from "@/lib/pg-error";

import { authConfig } from "./config";
import { hashDeIsca, hashPassword, senhaInvalida, verifyPassword } from "@scribe/auth";

/**
 * Criar conta e conferir senha — o provedor `password`.
 *
 * Com `AUTH_PROVIDER=supabase` este arquivo não é chamado: quem guarda e
 * confere a senha é o Auth do Supabase, e a aplicação só valida o token que
 * ele emitiu. Ver ADR-0004.
 */

/**
 * Normaliza o e-mail.
 *
 * Minúsculas e sem espaços nas pontas, sempre, nos dois caminhos — cadastro e
 * login. É a metade que falta do índice único: sem ela, "Ana@x.com" e
 * "ana@x.com" viram duas contas, e a pessoa descobre no dia em que a segunda
 * estiver vazia.
 *
 * Nada além disso. Remover pontos do Gmail ou cortar sufixo `+etiqueta` seria
 * decidir, por conta própria, que dois endereços diferentes são a mesma
 * pessoa — e existem provedores onde não são.
 */
export function normalizarEmail(bruto: string): string {
  return bruto.trim().toLowerCase();
}

/** Suficiente para pegar erro de digitação; o resto é com o servidor de e-mail. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailInvalido(email: string): string | null {
  if (email === "") return "Informe o e-mail.";
  if (email.length > 320) return "E-mail longo demais.";
  if (!EMAIL.test(email)) return "E-mail com formato inválido.";
  return null;
}

/**
 * Executa `fn` com o papel que ignora as políticas RLS.
 *
 * ⚠️ Dentro deste bloco NÃO EXISTE isolamento entre profissionais.
 *
 * Existe por um motivo só: encontrar uma conta pelo e-mail, o que acontece
 * necessariamente ANTES de haver identidade para filtrar. É o ovo e a galinha
 * do login — `auth.professional_id()` resolve a partir de quem já entrou.
 *
 * A alternativa seria uma função `SECURITY DEFINER` que devolvesse o hash a
 * qualquer usuário autenticado, o que é pior: exporia o hash de todo mundo a
 * quem já tem conta. Aqui o alcance é este arquivo, e as duas consultas abaixo
 * são as únicas que ele faz.
 */
async function semIsolamento<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`set local role service_role`);
    return fn(tx as unknown as Database);
  });
}

export type ResultadoCadastro =
  | { readonly ok: true; readonly authUserId: string }
  | { readonly ok: false; readonly erro: string };

export async function criarConta(entrada: {
  nome: string;
  email: string;
  senha: string;
}): Promise<ResultadoCadastro> {
  const nome = entrada.nome.trim();
  const email = normalizarEmail(entrada.email);

  if (nome === "") return { ok: false, erro: "Informe seu nome." };
  if (nome.length > 200) return { ok: false, erro: "Nome longo demais." };

  const problemaEmail = emailInvalido(email);
  if (problemaEmail !== null) return { ok: false, erro: problemaEmail };

  const problemaSenha = senhaInvalida(entrada.senha);
  if (problemaSenha !== null) return { ok: false, erro: problemaSenha };

  const authUserId = randomUUID();
  const passwordHash = await hashPassword(entrada.senha);

  try {
    /**
     * O cadastro roda SOB RLS, e isso não é detalhe.
     *
     * A política de `professionals` exige `auth_user_id = auth.uid()` no
     * `with check`. Assumindo a identidade recém-sorteada, o insert passa —
     * e passa apenas para a própria linha. Uma conta criada aqui não consegue,
     * nem por erro de código, nascer apontando para outra pessoa.
     */
    await withProfessional(getDb(), authUserId, async (tx) => {
      await tx.insert(professionals).values({
        authUserId,
        email,
        passwordHash,
        name: nome,
      });
    });
  } catch (error) {
    // O índice único de e-mail é quem decide, e não uma consulta anterior:
    // entre a consulta e o insert cabe outro cadastro. Por isso a duplicidade
    // é tratada como resultado esperado deste caminho, não como exceção.
    if (codigoPostgres(error) === UNIQUE_VIOLATION) {
      return { ok: false, erro: "Já existe uma conta com este e-mail." };
    }
    throw error;
  }

  return { ok: true, authUserId };
}

/**
 * Confere e-mail e senha. Devolve o `auth_user_id` ou `null`.
 *
 * Um `null` só, para conta inexistente, senha errada, conta apagada e
 * identidade que vive no Supabase. Distinguir esses casos na resposta
 * entregaria a lista de quem tem conta — que, num produto de saúde, já é
 * informação sobre a pessoa antes mesmo de qualquer dado clínico.
 */
export async function autenticar(
  emailBruto: string,
  senha: string,
): Promise<string | null> {
  const email = normalizarEmail(emailBruto);
  if (emailInvalido(email) !== null) {
    // Ainda assim deriva um hash: sair daqui em 1 ms responderia "este e-mail
    // nem chegou a ser procurado", e o tempo de resposta é uma resposta.
    await verifyPassword(senha, await hashDeIsca());
    return null;
  }

  const [conta] = await semIsolamento((tx) =>
    tx
      .select({
        authUserId: professionals.authUserId,
        passwordHash: professionals.passwordHash,
        deletedAt: professionals.deletedAt,
      })
      .from(professionals)
      .where(eq(professionals.email, email))
      .limit(1),
  );

  const hash = conta?.passwordHash ?? (await hashDeIsca());
  const confere = await verifyPassword(senha, hash);

  if (!confere) return null;
  if (conta === undefined || conta.deletedAt !== null) return null;
  return conta.authUserId;
}

/** O provedor em uso, para a interface dizer a verdade sobre o que oferece. */
export const provedorAtivo = authConfig.provider;
