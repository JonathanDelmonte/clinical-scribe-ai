import { documents, jobs, sessions, transcriptSegments } from "@scribe/db";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Pede a geração da nota clínica.
 *
 * Disparada por clique, nunca automática ao fim da transcrição — e essa é uma
 * decisão de produto, não de implementação.
 *
 * A separação de vozes é o passo em que a máquina tem menos certeza. Gerar a
 * nota automaticamente significa gerá-la sobre uma premissa que ninguém
 * conferiu: se o papel estiver trocado, a nota inverte quem relatou o quê, e o
 * profissional revisa um texto fluente construído ao contrário — o erro mais
 * caro de detectar, porque tudo nele parece certo.
 *
 * Com o clique, confirmar os papéis vira o portão. Custa um toque e coloca o
 * humano exatamente onde a incerteza está.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const result = await asCurrentProfessional(async (tx, me) => {
    // Sob RLS: sessão de outro profissional não é encontrada.
    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    if (session === undefined) {
      return { error: "sessão não encontrada", status: 404 } as const;
    }

    const trechos = await tx
      .select({ id: transcriptSegments.id, role: transcriptSegments.role })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.sessionId, session.id));

    if (trechos.length === 0) {
      return { error: "esta sessão ainda não tem transcrição", status: 409 } as const;
    }
    if (!trechos.some((t) => t.role === "professional")) {
      return {
        error:
          "Nenhum trecho está marcado como do profissional. Confirme os papéis " +
          "antes de gerar a nota.",
        status: 409,
      } as const;
    }

    // Um job já na fila para esta sessão significa clique duplo, ou duas abas
    // abertas. Enfileirar de novo gastaria uma chamada ao modelo para produzir
    // exatamente a mesma nota.
    const [pendente] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.sessionId, session.id),
          eq(jobs.kind, "generate_note"),
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
        kind: "generate_note",
      })
      .returning({ id: jobs.id });

    return { status: 202, jobId: job?.id ?? null, alreadyQueued: false } as const;
  });

  if (result === null || result === undefined) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  // `status` sai do corpo e vira o código HTTP. Todas as variantes carregam
  // um, o que faz o compilador garantir que nenhum caminho de retorno esqueça
  // de dizer o que aconteceu — com `exactOptionalPropertyTypes` ligado, um
  // campo ausente numa variante é erro de tipo, não um 500 em produção.
  const { status, ...corpo } = result;
  return NextResponse.json(corpo, { status });
}

/**
 * Descarta a nota em rascunho, para gerar de novo.
 *
 * O filtro `approvedAt is null` é a regra, não um detalhe: documento aprovado
 * é registro clínico, e registro clínico não some por clique errado. Uma nota
 * aprovada simplesmente não é encontrada por esta consulta.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const apagadas = await asCurrentProfessional(async (tx) => {
    const linhas = await tx
      .delete(documents)
      .where(
        and(
          eq(documents.sessionId, id),
          eq(documents.type, "clinical_note"),
          isNull(documents.approvedAt),
        ),
      )
      .returning({ id: documents.id });

    return linhas.length;
  });

  return NextResponse.json({ ok: true, apagadas: apagadas ?? 0 });
}
