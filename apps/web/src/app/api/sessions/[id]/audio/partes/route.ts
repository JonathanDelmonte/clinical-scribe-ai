import { sessions } from "@scribe/db";
import { sessionPartsPrefix } from "@scribe/storage";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";
import { storage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Quais pedaços desta sessão já chegaram.
 *
 * É a pergunta que torna a retomada barata. Depois de uma aba morta ou de uma
 * rede que caiu, o cliente não sabe o que subiu — só o servidor sabe. Sem esta
 * rota, retomar significaria reenviar o arquivo inteiro pela mesma rede que
 * acabou de derrubá-lo.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const resultado = await asCurrentProfessional(async (tx, me) => {
    // Sob RLS: sessão de outro profissional não é encontrada, e sem ela não se
    // chega ao prefixo de armazenamento — que começa pelo ID do dono
    // justamente para que a permissão seja um prefixo, não uma consulta.
    const [session] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    if (session === undefined) return null;

    const prefixo = sessionPartsPrefix(me.id, session.id);
    const chaves = await storage.list(prefixo);

    return chaves
      .map((chave) => Number(chave.slice(prefixo.length + 1)))
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b);
  });

  if (resultado === null) {
    return NextResponse.json({ error: "sessão não encontrada" }, { status: 404 });
  }

  return NextResponse.json({ partes: resultado });
}
