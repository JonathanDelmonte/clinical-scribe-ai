import { jobs, sessions } from "@scribe/db";
import { extensionOf, sessionAudioKey } from "@scribe/storage";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";
import { storage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** ~200 MB. Uma consulta de uma hora em webm/opus fica bem abaixo disso. */
const MAX_BYTES = 200 * 1024 * 1024;

/**
 * Extensões aceitas.
 *
 * Lista fechada em vez de confiar no content-type: o tipo declarado vem do
 * cliente e não custa nada mentir. A extensão só decide o nome do arquivo em
 * disco — quem realmente decodifica é o ffmpeg dentro do serviço de ASR, que
 * olha o conteúdo.
 */
const ALLOWED = new Set(["webm", "wav", "mp3", "m4a", "ogg", "opus", "flac", "mp4"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "envie um arquivo no campo 'file'" },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "arquivo vazio" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `arquivo maior que ${Math.round(MAX_BYTES / 1024 / 1024)} MB` },
      { status: 413 },
    );
  }

  const extension = extensionOf(file.name);
  if (!ALLOWED.has(extension)) {
    return NextResponse.json(
      { error: `formato .${extension} não aceito` },
      { status: 415 },
    );
  }

  const result = await asCurrentProfessional(async (tx, me) => {
    // Sob RLS: sessão de outro profissional simplesmente não é encontrada.
    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    if (session === undefined) return { error: "sessão não encontrada" } as const;

    const key = sessionAudioKey(me.id, session.id, extension);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await storage.put(key, bytes);

    await tx
      .update(sessions)
      .set({
        audioPath: key,
        status: "uploaded",
        endedAt: new Date(),
        failureReason: null,
      })
      .where(eq(sessions.id, session.id));

    // Enfileirar por último, e só depois de o áudio estar gravado: um job que
    // roda antes do arquivo existir falha, faz retry com backoff e polui o
    // log com um erro que não é erro nenhum.
    await tx.insert(jobs).values({
      professionalId: me.id,
      sessionId: session.id,
      kind: "transcribe",
    });

    return { ok: true, bytes: file.size, key } as const;
  });

  if (result === null) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json(result, { status: 202 });
}
