import { professionals } from "@scribe/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ASR_URL = process.env["ASR_LOCAL_URL"] ?? "http://localhost:8001";

/** ~50 MB. Trinta segundos de fala cabem com folga enorme. */
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * A dica técnica só em desenvolvimento.
 *
 * Quem roda o projeto no próprio computador precisa saber o comando; quem
 * está no site publicado não tem o que fazer com ele, e um comando de
 * terminal numa tela de cadastro só assusta.
 */
function comDica(mensagem: string, dica: string): string {
  return process.env.NODE_ENV === "production" ? mensagem : `${mensagem} (${dica})`;
}

/**
 * O serviço que analisa a voz está ao alcance?
 *
 * A tela pergunta antes de pedir a gravação. Descobrir no fim, depois de ler
 * as frases em voz alta, que nada podia ser cadastrado é o pior momento para
 * descobrir. No site publicado a resposta hoje é "não": ver a primeira
 * pendência de `docs/PENDENCIAS.md`.
 */
export async function GET() {
  const res = await fetch(`${ASR_URL}/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  }).catch(() => null);
  return NextResponse.json({ disponivel: res !== null && res.ok });
}

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
    return NextResponse.json(
      { error: "Envie a gravação da sua voz." },
      { status: 400 },
    );
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "A gravação chegou vazia ou grande demais. Grave de novo." },
      { status: 400 },
    );
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
      {
        error: comDica(
          "O serviço que analisa a voz não está ligado agora. Sua gravação não foi guardada.",
          "rode `pnpm asr:up`",
        ),
      },
      { status: 503 },
    );
  }
  if (!res.ok) {
    // O motor explica o problema para quem o opera. Aqui a explicação é para
    // quem gravou: o que aconteceu e o que dá para fazer.
    const mensagem =
      res.status === 400
        ? "A gravação ficou curta para reconhecer a sua voz. Grave de novo, lendo as frases até o fim."
        : res.status === 503
          ? comDica(
              "O reconhecimento de voz não está configurado neste servidor.",
              "falta o HF_TOKEN no motor",
            )
          : "Não foi possível analisar a gravação. Tente de novo.";
    return NextResponse.json({ error: mensagem }, { status: res.status });
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
    return NextResponse.json(
      { error: "Sua sessão expirou. Entre de novo." },
      { status: 401 },
    );
  }
  return NextResponse.json({ ok: true, durationSeconds: duration_s });
}

/** Apaga a impressão vocal: direito do titular sobre o próprio dado. */
export async function DELETE() {
  const ok = await asCurrentProfessional(async (tx, me) => {
    await tx
      .update(professionals)
      .set({ voiceEmbedding: null, voiceEnrolledAt: null })
      .where(eq(professionals.id, me.id));
    return true;
  });
  if (ok === null) {
    return NextResponse.json(
      { error: "Sua sessão expirou. Entre de novo." },
      { status: 401 },
    );
  }
  return NextResponse.json({ ok: true });
}
