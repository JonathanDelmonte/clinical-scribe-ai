import { NextResponse } from "next/server";
import { z } from "zod";

import { DEV_USER_COOKIE } from "@/lib/auth";

/**
 * Troca o profissional ativo — apenas desenvolvimento.
 *
 * ⚠️ Sem senha, sem verificação. Qualquer um que chegue nesta rota vira
 * qualquer profissional. Existe para tornar observável a diferença entre
 * cargos: trocando de usuário você vê `resolveEngine()` decidindo diferente.
 *
 * Precisa sumir antes do primeiro usuário real.
 */
const schema = z.object({ authUserId: z.string().uuid() });

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "indisponível" }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "authUserId inválido" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(DEV_USER_COOKIE, parsed.data.authUserId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
