import { NextResponse } from "next/server";

import { currentProfessional } from "@/lib/auth";
import { storage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Devolve a assinatura do profissional logado.
 *
 * Sem parâmetro de chave, de propósito: a única assinatura que esta rota sabe
 * servir é a de quem está pedindo. Uma rota que aceitasse `?key=` precisaria
 * provar, a cada requisição, que a chave pertence a quem pediu — e é essa
 * prova que costuma ficar para depois.
 */
export async function GET() {
  const me = await currentProfessional().catch(() => null);
  if (me === null) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  if (me.signatureUrl === null) {
    return NextResponse.json({ error: "sem assinatura" }, { status: 404 });
  }

  const bytes = await storage.get(me.signatureUrl).catch(() => null);
  if (bytes === null) {
    return NextResponse.json({ error: "arquivo ausente" }, { status: 404 });
  }

  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      // Assinatura é identificador pessoal: nunca em cache compartilhado.
      "cache-control": "private, no-store",
    },
  });
}
