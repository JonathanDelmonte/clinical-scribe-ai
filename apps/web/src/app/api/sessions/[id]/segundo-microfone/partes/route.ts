import { secondChannelPartsPrefix } from "@scribe/storage";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";
import { storage } from "@/lib/storage";

import { sessaoQueAceita } from "../comum";

export const dynamic = "force-dynamic";

/**
 * Quais pedaços do segundo microfone já chegaram — para retomar um envio sem
 * recomeçar. A mesma pergunta de `audio/partes`, sobre a pasta do segundo
 * microfone.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const resultado = await asCurrentProfessional(async (tx, me) => {
    const aceita = await sessaoQueAceita(tx, id, false);
    if (!("sessao" in aceita)) return null;

    const prefixo = secondChannelPartsPrefix(me.id, aceita.sessao.id);
    return (await storage.list(prefixo))
      .map((chave) => Number(chave.slice(prefixo.length + 1)))
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b);
  });

  if (resultado === null || resultado === undefined) {
    return NextResponse.json({ error: "sessão não encontrada" }, { status: 404 });
  }
  return NextResponse.json({ partes: resultado });
}
