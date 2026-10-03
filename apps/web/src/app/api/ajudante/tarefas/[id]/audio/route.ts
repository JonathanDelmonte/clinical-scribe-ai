import { esquemaDoAvisoDeAudio } from "@scribe/processamento";
import { NextResponse } from "next/server";

import { lerCorpo, rotaDoAjudante } from "@/lib/ajudante/rota";
import { avisarAudio } from "@/lib/ajudante/tarefas";

export const dynamic = "force-dynamic";

/**
 * A cópia da consulta já está no armazenamento (ou não havia o que guardar):
 * a sessão passa a apontar para ela, e a quota decide se o motor trabalha.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return rotaDoAjudante(request, async (ajudante) => {
    const lido = await lerCorpo(request, esquemaDoAvisoDeAudio);
    if (!lido.ok) return lido.resposta;
    return NextResponse.json(await avisarAudio(ajudante, id, lido.corpo));
  });
}
