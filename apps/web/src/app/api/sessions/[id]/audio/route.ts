import type { Account } from "@scribe/core";
import { jobs, sessions } from "@scribe/db";
import { extensionOf, sessionAudioKey } from "@scribe/storage";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";
import { verificarQuota } from "@/lib/quota";
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
  /**
   * Duração declarada pelo dispositivo, do áudio que está subindo.
   *
   * Serve para a conferência de quota ANTES do processamento. Dispositivo
   * mente, e a defesa não é confiar nele: o consumo do mês vem de
   * `usage_events`, escrito pelo worker com a duração real medida no áudio.
   * Uma mentira aqui passa por uma sessão e é barrada na seguinte.
   */
  let durationMs: number | null = null;
  if (typeof mapaBruto === "string") {
    try {
      const m = JSON.parse(mapaBruto) as {
        regions?: unknown;
        removedMs?: unknown;
        durationMs?: unknown;
      };
      if (typeof m.removedMs === "number" && Number.isFinite(m.removedMs)) {
        silenceRemovedMs = Math.max(0, Math.round(m.removedMs));
      }
      if (typeof m.durationMs === "number" && Number.isFinite(m.durationMs)) {
        durationMs = Math.max(0, Math.round(m.durationMs));
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

    /**
     * O áudio é gravado ANTES da conferência de quota, e isso é deliberado.
     *
     * A consulta já aconteceu. Recusar o upload por quota apagaria uma
     * gravação que não existe em outro lugar e não pode ser refeita — as
     * pessoas já foram embora. O que a quota protege é o CUSTO, e o custo está
     * no processamento, não no disco.
     *
     * Então a ordem é: guarda o áudio, confere a quota, e só enfileira se
     * couber. Quem estourou o plano fica com a gravação intacta e uma sessão
     * que diz exatamente o que aconteceu.
     */
    await storage.put(key, bytes);

    const account: Account = {
      role: me.role,
      plan: me.plan,
      preferredEngine: me.preferredEngine,
    };
    const quota = await verificarQuota(
      tx,
      account,
      durationMs === null ? null : durationMs / 60_000,
    );

    if (!quota.permitido) {
      await tx
        .update(sessions)
        .set({
          audioPath: key,
          status: "failed",
          endedAt: new Date(),
          durationMs,
          silenceRemovedMs,
          speechRegions,
          failureReason:
            `${quota.motivo} A gravação está guardada e será processada ` +
            `quando houver quota — no próximo mês, ou mudando de plano.`,
        })
        .where(eq(sessions.id, session.id));

      return { quotaExcedida: true, motivo: quota.motivo, quota: quota.quota } as const;
    }

    await tx
      .update(sessions)
      .set({
        audioPath: key,
        status: "uploaded",
        endedAt: new Date(),
        durationMs,
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

    return { ok: true, bytes: file.size, key, quota: quota.quota } as const;
  });

  if (result === null) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  if ("quotaExcedida" in result) {
    // 402: a requisição está correta, a gravação foi guardada, e o que falta
    // é plano. 403 diria "você não pode", que não é verdade — pode, no mês que
    // vem. 429 diria "tente de novo já já", que também não.
    return NextResponse.json(
      { error: result.motivo, quota: result.quota, audioPreservado: true },
      { status: 402 },
    );
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
