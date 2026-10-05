import { NextResponse } from "next/server";

import { enderecoDoDownload } from "@/lib/ajudante/download";
import { currentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * O download do ajudante, para quem tem conta. O endereço do arquivo é
 * decidido no servidor (`lib/ajudante/download.ts`): o link do site é sempre
 * este, esteja o arquivo onde estiver.
 */
export async function GET(request: Request) {
  const eu = await currentProfessional().catch(() => null);
  if (eu === null) {
    const entrar = new URL("/entrar", request.url);
    entrar.searchParams.set("de", "/configuracoes#ajudante");
    return NextResponse.redirect(entrar, 303);
  }

  const destino = await enderecoDoDownload();
  if (destino === null) {
    const volta = new URL("/configuracoes", request.url);
    volta.searchParams.set("ajudante", "indisponivel");
    volta.hash = "ajudante";
    return NextResponse.redirect(volta, 303);
  }
  return NextResponse.redirect(destino, 303);
}
