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

  /**
   * O mapa de tempo que o dispositivo mandou junto.
   *
   * Lido defensivamente e ignorado quando estranho: um mapa malformado não
   * pode impedir o áudio de ser gravado. A consulta já aconteceu; perder a
   * gravação por causa de metadado seria trocar o essencial pelo acessório.
   */
  const mapaBruto = form?.get("audioMap");
  let silenceRemovedMs: number | null = null;
  let speechRegions: unknown = null;
  if (typeof mapaBruto === "string") {
    try {
      const m = JSON.parse(mapaBruto) as { regions?: unknown; removedMs?: unknown };
      if (typeof m.removedMs === "number" && Number.isFinite(m.removedMs)) {
        silenceRemovedMs = Math.max(0, Math.round(m.removedMs));
      }
      if (Array.isArray(m.regions)) speechRegions = m.regions;
    } catch {
      // mapa inválido: segue sem ele
    }
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
        silenceRemovedMs,
        speechRegions,
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

const CONTENT_TYPES: Record<string, string> = {
  webm: "audio/webm",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
};

/**
 * Devolve o áudio da consulta, para a revisão ancorada.
 *
 * É a metade que falta do mecanismo anti-alucinação. A conferência
 * determinística prova que a fonte citada EXISTE; só ouvir prova que ela
 * SUSTENTA a afirmação. Sem áudio clicável, "revisar a nota" vira reler um
 * texto fluente — que é exatamente a situação em que 62% dos achados
 * fabricados passaram despercebidos (§11 da documentação).
 *
 * Responde a `Range` porque o navegador precisa disso para pular direto ao
 * segundo 7:42 sem baixar os 11 minutos antes. Sem cabeçalho de faixa, o
 * Chrome recusa o seek em webm e o clique numa citação não faz nada.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const found = await asCurrentProfessional(async (tx) => {
    const [session] = await tx
      .select({ audioPath: sessions.audioPath })
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    return session?.audioPath ?? null;
  });

  if (found === null || found === undefined) {
    return NextResponse.json({ error: "áudio não encontrado" }, { status: 404 });
  }

  const bytes = await storage.get(found).catch(() => null);
  if (bytes === null) {
    return NextResponse.json({ error: "arquivo ausente no storage" }, { status: 404 });
  }

  const type = CONTENT_TYPES[extensionOf(found)] ?? "application/octet-stream";
  const total = bytes.byteLength;

  const comum = {
    "content-type": type,
    "accept-ranges": "bytes",
    // Áudio de consulta nunca pode encostar num cache compartilhado.
    "cache-control": "private, no-store",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range === null) {
    return new Response(bytes, {
      status: 200,
      headers: { ...comum, "content-length": String(total) },
    });
  }

  const inicio = range[1] === "" ? 0 : Number(range[1]);
  const fim = range[2] === "" ? total - 1 : Math.min(Number(range[2]), total - 1);

  if (Number.isNaN(inicio) || inicio > fim || inicio >= total) {
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${total}` },
    });
  }

  return new Response(bytes.subarray(inicio, fim + 1), {
    status: 206,
    headers: {
      ...comum,
      "content-range": `bytes ${inicio}-${fim}/${total}`,
      "content-length": String(fim - inicio + 1),
    },
  });
}
