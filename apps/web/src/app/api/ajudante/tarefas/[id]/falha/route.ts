import { esquemaDaFalha } from "@scribe/processamento";
import { NextResponse } from "next/server";

import { lerCorpo, rotaDoAjudante } from "@/lib/ajudante/rota";
import { registrarFalha } from "@/lib/ajudante/tarefas";

export const dynamic = "force-dynamic";

/** Por que o ajudante não terminou — cada motivo tem um destino. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return rotaDoAjudante(request, async (ajudante) => {
    const lido = await lerCorpo(request, esquemaDaFalha);
    if (!lido.ok) return lido.resposta;
    await registrarFalha(ajudante, id, lido.corpo);
    return NextResponse.json({ ok: true });
  });
}
