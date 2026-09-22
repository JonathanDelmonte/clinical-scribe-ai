import { sessions } from "@scribe/db";
import { sessionPartKey } from "@scribe/storage";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";
import { limitarPorProfissional } from "@/lib/limites";
import { storage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Teto de pedaços por sessão.
 *
 * Com 512 KB por pedaço, 2000 deles são 1 GB — dez vezes mais do que o maior
 * áudio que o produto aceita. O limite não está aqui para apertar o uso
 * legítimo: está para que um índice absurdo não vire uma pasta com um milhão
 * de arquivos de um byte.
 */
const MAX_PARTES = 2000;

/** Um pedaço não pode ser maior que o arquivo inteiro que aceitamos. */
const MAX_PARTE_BYTES = 8 * 1024 * 1024;

/**
 * Recebe um pedaço do áudio.
 *
 * `PUT` e não `POST` porque é idempotente por natureza: mandar o mesmo índice
 * duas vezes — o que acontece toda vez que uma resposta se perde no caminho de
 * volta e o cliente tenta de novo — precisa resultar no mesmo estado, e não
 * num pedaço duplicado no meio da consulta.
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
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "pedaço vazio" }, { status: 400 });
  }
  if (bytes.byteLength > MAX_PARTE_BYTES) {
    return NextResponse.json({ error: "pedaço grande demais" }, { status: 413 });
  }

  const resultado = await asCurrentProfessional(async (tx, me) => {
    const [session] = await tx
      .select({ id: sessions.id, audioPath: sessions.audioPath })
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    if (session === undefined) return { error: "sessão não encontrada" } as const;

    /**
     * Uma sessão que já tem áudio não recebe pedaços novos.
     *
     * Sem esta recusa, um envio atrasado que chegasse depois da montagem
     * deixaria lixo no armazenamento — e, pior, um segundo `finalizar`
     * montaria um áudio diferente por cima de uma consulta já transcrita.
     */
    if (session.audioPath !== null) {
      return { error: "esta sessão já tem áudio" } as const;
    }

    await storage.put(sessionPartKey(me.id, session.id, n), bytes);
    return { ok: true } as const;
  });

  if (resultado === null) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  if ("error" in resultado) {
    return NextResponse.json(
      { error: resultado.error },
      { status: resultado.error === "esta sessão já tem áudio" ? 409 : 404 },
    );
  }

  return new Response(null, { status: 204 });
}
