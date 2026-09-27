import { sessions } from "@scribe/db";
import {
  sessionPartKey,
  sessionPartsManifestKey,
  sessionPartsPrefix,
  type ManifestoDePartes,
} from "@scribe/storage";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { asCurrentProfessional } from "@/lib/auth";
import { limitarPorProfissional } from "@/lib/limites";
import { storage } from "@/lib/storage";
import { EXTENSOES_ACEITAS, registrarAudio } from "@/lib/upload";

export const dynamic = "force-dynamic";

const schema = z.object({
  total: z.number().int().positive().max(2000),
  extensao: z.string().max(8),
  durationMs: z.number().nonnegative().nullable(),
  removedMs: z.number().nonnegative().nullable(),
  regions: z.unknown(),
});

/**
 * Fecha o envio e manda processar.
 *
 * A conferência que importa está logo no começo: **todos** os pedaços
 * precisam estar presentes. Montar com um buraco no meio produziria um
 * arquivo que ainda é um arquivo válido, que o Whisper transcreveria sem
 * reclamar, e cuja falta seria uma parte da consulta simplesmente ausente da
 * nota — sem erro em lugar nenhum. É a classe de falha mais cara que este
 * produto tem: a que não parece falha.
 *
 * ## Os pedaços NÃO são juntados aqui
 *
 * Esta rota juntava tudo num arquivo só. Na nuvem isso quebra de dois jeitos:
 * o Supabase gratuito recusa arquivo acima de 50 MB — uns 27 minutos de fala
 * em WAV —, e uma consulta de horas são centenas de megabytes para caber na
 * memória e no tempo de uma função. Agora a rota grava um manifesto de poucos
 * bytes e aponta a sessão para ele; o worker junta os pedaços, transcreve a
 * partir do áudio inteiro, e guarda o arquivo final. Ver o handler de
 * transcrição e `sessionPartsManifestKey`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const barrado = await limitarPorProfissional("upload");
  if (barrado !== null) return barrado;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "dados inválidos" }, { status: 400 });
  }

  const extensao = parsed.data.extensao.replace(/^\./, "").toLowerCase();
  if (!EXTENSOES_ACEITAS.has(extensao)) {
    return NextResponse.json(
      { error: `formato .${extensao} não aceito` },
      { status: 415 },
    );
  }

  const resultado = await asCurrentProfessional(async (tx, me) => {
    const [session] = await tx
      .select({ id: sessions.id, audioPath: sessions.audioPath })
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    if (session === undefined) return { error: "sessão não encontrada" } as const;
    if (session.audioPath !== null) {
      return { error: "esta sessão já tem áudio" } as const;
    }

    const prefixo = sessionPartsPrefix(me.id, session.id);
    const presentes = new Set(await storage.list(prefixo));

    const faltando: number[] = [];
    for (let i = 0; i < parsed.data.total; i++) {
      if (!presentes.has(sessionPartKey(me.id, session.id, i))) faltando.push(i);
    }
    if (faltando.length > 0) {
      return { faltando } as const;
    }

    // Os pedaços ficam onde estão; o manifesto diz quantos são e o que formam.
    const manifesto: ManifestoDePartes = { partes: parsed.data.total, extensao };
    const key = sessionPartsManifestKey(me.id, session.id);
    await storage.put(
      key,
      new TextEncoder().encode(JSON.stringify(manifesto)) as Uint8Array<ArrayBuffer>,
    );

    const registro = await registrarAudio(tx, me, session.id, {
      key,
      durationMs:
        parsed.data.durationMs === null ? null : Math.round(parsed.data.durationMs),
      silenceRemovedMs:
        parsed.data.removedMs === null ? null : Math.round(parsed.data.removedMs),
      speechRegions: Array.isArray(parsed.data.regions) ? parsed.data.regions : null,
    });

    // Os pedaços só saem depois que o worker grava o arquivo final — é ele
    // quem os apaga. Até lá, eles SÃO a consulta.
    return "ok" in registro
      ? ({ ok: true, partes: parsed.data.total, key, quota: registro.quota } as const)
      : registro;
  });

  if (resultado === null) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  if ("faltando" in resultado) {
    // 409 e a lista do que falta: o cliente reenvia exatamente esses pedaços e
    // chama de novo, em vez de recomeçar o arquivo inteiro.
    return NextResponse.json(
      {
        error:
          resultado.faltando.length === 1
            ? "falta 1 pedaço do áudio"
            : `faltam ${resultado.faltando.length} pedaços do áudio`,
        faltando: resultado.faltando,
      },
      { status: 409 },
    );
  }
  if ("error" in resultado) {
    return NextResponse.json(
      { error: resultado.error },
      { status: resultado.error === "sessão não encontrada" ? 404 : 409 },
    );
  }
  if ("quotaExcedida" in resultado) {
    return NextResponse.json(
      { error: resultado.motivo, quota: resultado.quota, audioPreservado: true },
      { status: 402 },
    );
  }

  return NextResponse.json(resultado, { status: 202 });
}
