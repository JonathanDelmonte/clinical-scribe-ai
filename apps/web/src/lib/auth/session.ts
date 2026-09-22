import "server-only";

import { cookies } from "next/headers";

import { authConfig } from "./config";
import { signSessionToken, verifySessionToken, type SessionClaims } from "@scribe/auth";

/**
 * O cookie de sessão — leitura e escrita, no servidor.
 *
 * Os três atributos, e o que cada um impede:
 *
 * - `httpOnly`  — JavaScript da página não lê o cookie. É o que faz um XSS
 *                 roubar a tela em vez de roubar a sessão.
 * - `sameSite`  — `lax`: o cookie não acompanha requisição vinda de outro
 *                 site, o que fecha CSRF nas rotas que mudam estado. `strict`
 *                 quebraria o retorno de um link externo (o e-mail que o
 *                 produto vai mandar um dia) sem ganho real aqui.
 * - `secure`    — só em produção. Em desenvolvimento o host é `http://localhost`
 *                 e um cookie `Secure` simplesmente não seria gravado — o
 *                 sintoma seria "o login não funciona", sem erro nenhum.
 */

export async function lerSessao(): Promise<SessionClaims | null> {
  const store = await cookies();
  return verifySessionToken(store.get(authConfig.cookieName)?.value, authConfig.secret);
}

export function novoToken(authUserId: string): string {
  return signSessionToken(
    {
      sub: authUserId,
      exp: Math.floor(Date.now() / 1000) + authConfig.ttlSeconds,
    },
    authConfig.secret,
  );
}

/** Grava a sessão. Só funciona em rota de API ou server action. */
export async function abrirSessao(authUserId: string): Promise<void> {
  const store = await cookies();
  store.set(authConfig.cookieName, novoToken(authUserId), {
    httpOnly: true,
    sameSite: "lax",
    secure: authConfig.secureCookie,
    path: "/",
    maxAge: authConfig.ttlSeconds,
  });
}

export async function encerrarSessao(): Promise<void> {
  const store = await cookies();
  store.set(authConfig.cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: authConfig.secureCookie,
    path: "/",
    maxAge: 0,
  });
}
