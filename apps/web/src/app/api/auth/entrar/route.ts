import { NextResponse } from "next/server";
import { z } from "zod";

import { autenticar } from "@/lib/auth/accounts";
import { abrirSessao } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().max(320),
  senha: z.string().max(500),
});

/**
 * Entrar.
 *
 * Uma única mensagem de erro para e-mail inexistente e senha errada, e o mesmo
 * tempo de resposta nos dois casos (ver `hashDeIsca` em auth/password.ts).
 * Distinguir os dois é entregar a lista de quem tem conta — e, num escriba
 * clínico, saber que alguém é cliente já é saber algo sobre essa pessoa.
 *
 * Força bruta é barrada na Fase 11 (rate limiting), e isso está anotado aqui
 * de propósito: enquanto não estiver, o mínimo é que cada tentativa custe os
 * ~50 ms do scrypt.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "dados inválidos" }, { status: 400 });
  }

  const authUserId = await autenticar(parsed.data.email, parsed.data.senha);
  if (authUserId === null) {
    return NextResponse.json({ error: "E-mail ou senha incorretos." }, { status: 401 });
  }

  await abrirSessao(authUserId);
  return NextResponse.json({ ok: true });
}
