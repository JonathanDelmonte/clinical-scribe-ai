import { sessions } from "@scribe/db";
import { extensionOf, sessionAudioKey } from "@scribe/storage";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";
import { storage } from "@/lib/storage";
import {
  EXTENSOES_ACEITAS,
  MAX_AUDIO_BYTES,
  registrarAudio,
  type AudioRecebido,
} from "@/lib/upload";

export const dynamic = "force-dynamic";

/**
 * Envio direto, de uma vez só — o caminho do arquivo escolhido na tela.
 *
 * A gravação feita no navegador usa `audio/partes`, que sobe em pedaços e
 * retoma quando a rede cai. Este caminho continua existindo porque um arquivo
 * que já está no disco da pessoa não corre o risco que a retomada protege: se
 * falhar, ele ainda está lá para tentar de novo.
 *
 * Os dois terminam em `registrarAudio()`. A regra de quota mora lá, uma vez
 * só — duplicá-la seria criar um caminho em que ela é esquecida, e esse
 * caminho custa dinheiro toda vez que alguém passa por ele.
 */
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
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `arquivo maior que ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB` },
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
  const mapa = lerMapa(form?.get("audioMap"));

  const extension = extensionOf(file.name);
  if (!EXTENSOES_ACEITAS.has(extension)) {
    return NextResponse.json(
      { error: `formato .${extension} não aceito` },
      { status: 415 },
    );
  }

  const result = await asCurrentProfessional(async (tx, me) => {
    // Sob RLS: sessão de outro profissional simplesmente não é encontrada.
    const [session] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    if (session === undefined) return { error: "sessão não encontrada" } as const;

    const key = sessionAudioKey(me.id, session.id, extension);
    await storage.put(key, new Uint8Array(await file.arrayBuffer()));

    const audio: AudioRecebido = { key, ...mapa };
    const registro = await registrarAudio(tx, me, session.id, audio);

    return "ok" in registro
      ? ({ ok: true, bytes: file.size, key, quota: registro.quota } as const)
      : registro;
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

/** Lê `durationMs`, `removedMs` e as regiões, ignorando o que vier estranho. */
function lerMapa(bruto: FormDataEntryValue | null | undefined): {
  durationMs: number | null;
  silenceRemovedMs: number | null;
  speechRegions: unknown;
} {
  const vazio = { durationMs: null, silenceRemovedMs: null, speechRegions: null };
  if (typeof bruto !== "string") return vazio;

  try {
    const m = JSON.parse(bruto) as {
      regions?: unknown;
      removedMs?: unknown;
      durationMs?: unknown;
    };
    return {
      durationMs:
        typeof m.durationMs === "number" && Number.isFinite(m.durationMs)
          ? Math.max(0, Math.round(m.durationMs))
          : null,
      silenceRemovedMs:
        typeof m.removedMs === "number" && Number.isFinite(m.removedMs)
          ? Math.max(0, Math.round(m.removedMs))
          : null,
      speechRegions: Array.isArray(m.regions) ? m.regions : null,
    };
  } catch {
    return vazio;
  }
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
