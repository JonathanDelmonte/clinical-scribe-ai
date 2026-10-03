import { esquemaDaEntrega } from "@scribe/processamento";
import { NextResponse } from "next/server";

import { lerCorpo, rotaDoAjudante } from "@/lib/ajudante/rota";
import { entregar } from "@/lib/ajudante/tarefas";

export const dynamic = "force-dynamic";

/**
 * O que o motor respondeu — a transcrição, ou a impressão vocal. Uma consulta
 * de uma hora são uns 200 KB de trechos: cabe folgado no limite de corpo de
 * uma função (4,5 MB na Vercel).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return rotaDoAjudante(request, async (ajudante) => {
    const lido = await lerCorpo(request, esquemaDaEntrega);
    if (!lido.ok) return lido.resposta;
    await entregar(ajudante, id, lido.corpo);
    return NextResponse.json({ ok: true });
  });
}
