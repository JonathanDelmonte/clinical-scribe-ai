import { secondChannelPartKey } from "@scribe/storage";
import { NextResponse } from "next/server";

import { MAX_CORPO_BUFFERIZADO_BYTES } from "@/lib/audio";
import { asCurrentProfessional } from "@/lib/auth";
import { limitarPorProfissional } from "@/lib/limites";
import { storage } from "@/lib/storage";

import { sessaoQueAceita } from "../../comum";

export const dynamic = "force-dynamic";

const MAX_PARTES = 2000;
const MAX_PARTE_BYTES = Math.min(8 * 1024 * 1024, MAX_CORPO_BUFFERIZADO_BYTES);

/**
 * Um pedaço da gravação do segundo celular, no caminho de reserva.
 *
 * Só existe para o formato que o navegador não lê: ele não consegue medir o
 * volume, então o arquivo sobe para o motor medir. Em pedaços pelo mesmo
 * motivo do áudio principal — acima de 10 MB o Next corta o corpo sem avisar.
 * As regras de cada pedaço são as de `audio/partes/[indice]`.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; indice: string }> },
) {
  const { id, indice } = await params;

  const barrado = await limitarPorProfissional("pedaco");
  if (barrado !== null) return barrado;

  const n = Number(indice);
  if (!Number.isInteger(n) || n < 0 || n >= MAX_PARTES) {
    return NextResponse.json({ error: "índice de pedaço inválido" }, { status: 400 });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  const declarado = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declarado) && declarado !== bytes.byteLength) {
    return NextResponse.json(
      { error: "o pedaço chegou incompleto — envie de novo" },
      { status: 400 },
    );
  }
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "pedaço vazio" }, { status: 400 });
  }
  if (bytes.byteLength > MAX_PARTE_BYTES) {
    return NextResponse.json({ error: "pedaço grande demais" }, { status: 413 });
  }

  const resultado = await asCurrentProfessional(async (tx, me) => {
    const aceita = await sessaoQueAceita(tx, id, false);
    if (!("sessao" in aceita)) return aceita;
    await storage.put(secondChannelPartKey(me.id, aceita.sessao.id, n), bytes);
    return { ok: true } as const;
  });

  if (resultado === null) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  if (!("ok" in resultado)) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  return new Response(null, { status: 204 });
}
