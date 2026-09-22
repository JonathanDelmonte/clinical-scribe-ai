import { objetivoPorSlug } from "@scribe/core";
import { jobs, sessions, transcriptSegments } from "@scribe/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";
import { limitarPorProfissional } from "@/lib/limites";

export const dynamic = "force-dynamic";

/**
 * Pede a geração de um documento do objetivo da sessão.
 *
 * O slug é validado contra a biblioteca ANTES de virar job. Enfileirar um
 * objetivo inexistente gastaria as três tentativas da fila para descobrir, no
 * worker, algo que a rota sabia de imediato.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const corpo = (await request.json().catch(() => null)) as { slug?: unknown } | null;
  const slug = typeof corpo?.slug === "string" ? corpo.slug : "";

  if (objetivoPorSlug(slug) === null) {
    return NextResponse.json(
      { error: `objetivo "${slug}" não existe` },
      { status: 400 },
    );
  }

  const barrado = await limitarPorProfissional("geracao");
  if (barrado !== null) return barrado;

  const result = await asCurrentProfessional(async (tx, me) => {
    const [session] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    if (session === undefined) {
      return { status: 404, error: "sessão não encontrada" } as const;
    }

    const trechos = await tx
      .select({ role: transcriptSegments.role })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.sessionId, session.id));

    if (!trechos.some((t) => t.role === "professional")) {
      return {
        status: 409,
        error:
          "Nenhum trecho está marcado como do profissional. Confirme os papéis antes " +
          "de gerar este documento.",
      } as const;
    }

    const [pendente] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.sessionId, session.id),
          eq(jobs.kind, "generate_objective"),
          eq(jobs.status, "pending"),
        ),
      )
      .limit(1);

    if (pendente !== undefined) {
      return { status: 202, jobId: pendente.id, alreadyQueued: true } as const;
    }

    const [job] = await tx
      .insert(jobs)
      .values({
        professionalId: me.id,
        sessionId: session.id,
        kind: "generate_objective",
        payload: { slug },
      })
      .returning({ id: jobs.id });

    return { status: 202, jobId: job?.id ?? null, alreadyQueued: false } as const;
  });

  if (result === null || result === undefined) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  const { status, ...body } = result;
  return NextResponse.json(body, { status });
}
