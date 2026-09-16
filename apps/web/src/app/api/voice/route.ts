import { professionals } from "@scribe/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ASR_URL = process.env["ASR_LOCAL_URL"] ?? "http://localhost:8001";

/** ~50 MB. Trinta segundos de fala cabem com folga enorme. */
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Cadastra a voz do profissional.
 *
 * Passo único de configuração, e o que habilita o Método A da §7 da
 * documentação: com a voz conhecida, cada trecho de cada consulta pode ser
 * comparado com ela.
 *
 * A amostra de áudio NÃO é guardada — só o vetor de 256 números derivado dela.
 * É minimização de dado (LGPD Art. 6º) e é suficiente: o vetor serve para
 * comparar, e a gravação original não teria outra utilidade.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "envie um arquivo de áudio" }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "arquivo inválido" }, { status: 400 });
  }

  const upstream = new FormData();
  upstream.append("file", file, file.name);

  const res = await fetch(`${ASR_URL}/voice-embedding`, {
    method: "POST",
    body: upstream,
    signal: AbortSignal.timeout(5 * 60 * 1000),
  }).catch(() => null);

  if (res === null) {
    return NextResponse.json(
      { error: "motor de transcrição indisponível — rode `pnpm asr:up`" },
      { status: 503 },
    );
  }
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { detail?: string } | null;
    return NextResponse.json(
      { error: corpo?.detail ?? "não foi possível processar a amostra" },
      { status: res.status },
    );
  }

  const { embedding, duration_s } = (await res.json()) as {
    embedding: number[];
    duration_s: number;
  };

  const salvo = await asCurrentProfessional(async (tx, me) => {
    await tx
      .update(professionals)
      .set({ voiceEmbedding: embedding, voiceEnrolledAt: new Date() })
      .where(eq(professionals.id, me.id));
    return true;
  });

  if (salvo === null) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, durationSeconds: duration_s });
}

/** Apaga a impressão vocal — direito do titular sobre o próprio dado. */
export async function DELETE() {
  const ok = await asCurrentProfessional(async (tx, me) => {
    await tx
      .update(professionals)
      .set({ voiceEmbedding: null, voiceEnrolledAt: null })
      .where(eq(professionals.id, me.id));
    return true;
  });
  if (ok === null) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
