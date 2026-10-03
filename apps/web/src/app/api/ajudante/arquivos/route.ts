import { LIMITE_ARQUIVO_UNICO_BYTES } from "@scribe/storage";
import { NextResponse } from "next/server";

import { conferirLink } from "@/lib/ajudante/arquivos";
import { storage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Os links de arquivo do ajudante, quando o armazenamento é o disco local
 * (desenvolvimento). Em produção os links são do próprio S3 e não passam por
 * aqui. Ver `lib/ajudante/arquivos.ts`.
 *
 * A autorização é a assinatura do link — um arquivo, um método, até a hora em
 * que vence —, e não cookie nem token.
 */
export async function GET(request: Request) {
  const chave = conferirLink(new URL(request.url).searchParams, "GET");
  if (chave === null)
    return NextResponse.json({ erro: "link inválido" }, { status: 403 });
  try {
    const bytes = await storage.get(chave);
    return new Response(bytes, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch {
    const existe = await storage.exists(chave).catch(() => true);
    return NextResponse.json(
      { erro: existe ? "falha ao ler" : "não existe" },
      { status: existe ? 500 : 404 },
    );
  }
}

export async function PUT(request: Request) {
  const chave = conferirLink(new URL(request.url).searchParams, "PUT");
  if (chave === null)
    return NextResponse.json({ erro: "link inválido" }, { status: 403 });
  const corpo = new Uint8Array(await request.arrayBuffer());
  if (corpo.byteLength === 0 || corpo.byteLength > LIMITE_ARQUIVO_UNICO_BYTES) {
    return NextResponse.json({ erro: "tamanho fora do limite" }, { status: 413 });
  }
  await storage.put(chave, corpo);
  return NextResponse.json({ ok: true });
}
