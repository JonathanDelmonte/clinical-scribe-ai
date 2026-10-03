import { esquemaDoAndamento } from "@scribe/processamento";
import { NextResponse } from "next/server";

import { lerCorpo, rotaDoAjudante } from "@/lib/ajudante/rota";
import { registrarAndamento } from "@/lib/ajudante/tarefas";

export const dynamic = "force-dynamic";

/** O ajudante segue trabalhando: renova a concessão e grava o andamento. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return rotaDoAjudante(request, async (ajudante) => {
    const lido = await lerCorpo(request, esquemaDoAndamento);
    if (!lido.ok) return lido.resposta;
    await registrarAndamento(ajudante, id, lido.corpo);
    return NextResponse.json({ ok: true });
  });
}
