import { NextResponse } from "next/server";

import { encerrarSessao } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Sair.
 *
 * `POST` e não `GET`: um `GET` que encerra sessão é derrubado por qualquer
 * `<img src="/api/auth/sair">` numa página de terceiro. Com `POST` e o cookie
 * em `SameSite=Lax`, a requisição vinda de fora não carrega a sessão e não faz
 * efeito.
 *
 * Apaga o cookie do navegador. Não invalida uma cópia do token que já tenha
 * saído daqui — a validade curta é o que limita esse estrago, e a nota em
 * `auth/token.ts` explica a escolha.
 */
export async function POST() {
  await encerrarSessao();
  return NextResponse.json({ ok: true });
}
