import { NextResponse } from "next/server";

import { rotaDoAjudante } from "@/lib/ajudante/rota";
import { pegarTarefa } from "@/lib/ajudante/tarefas";

export const dynamic = "force-dynamic";

/**
 * O próximo trabalho deste ajudante, como ordem de serviço — ou 204, sem
 * trabalho. Ver `lib/ajudante/tarefas.ts`.
 */
export async function POST(request: Request) {
  return rotaDoAjudante(request, async (ajudante) => {
    const ordem = await pegarTarefa(ajudante, new URL(request.url).origin);
    if (ordem === null) return new NextResponse(null, { status: 204 });
    return NextResponse.json(ordem);
  });
}
