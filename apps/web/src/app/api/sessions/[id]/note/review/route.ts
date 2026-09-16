import {
  allStatements,
  checkApproval,
  type ReviewedStatement,
  type SecaoChave,
} from "@scribe/core";
import { documents, sessions, transcriptSegments } from "@scribe/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface SecaoRecebida {
  key: SecaoChave;
  statements: ReviewedStatement[];
}

/**
 * Lê as seções vindas do cliente sem confiar nelas.
 *
 * O corpo desta requisição vira registro clínico depois da aprovação. Aceitar a
 * forma que chegou e gravar significaria aceitar qualquer coisa que alguém
 * mande com o cookie certo — inclusive uma afirmação com `sources` apontando
 * para trechos de OUTRA sessão, que a conferência então aprovaria.
 *
 * Por isso tudo é reconstruído campo a campo, e as fontes são filtradas contra
 * os trechos desta sessão logo depois, em `PATCH`.
 */
function lerSecoes(bruto: unknown): SecaoRecebida[] | null {
  if (!Array.isArray(bruto)) return null;

  const secoes: SecaoRecebida[] = [];
  for (const s of bruto) {
    if (typeof s !== "object" || s === null) return null;
    const { key, statements } = s as { key?: unknown; statements?: unknown };
    if (typeof key !== "string" || !Array.isArray(statements)) return null;

    const limpos: ReviewedStatement[] = [];
    for (const a of statements) {
      if (typeof a !== "object" || a === null) return null;
      const { path, text, sources, editedAt, confirmedAt } = a as Record<
        string,
        unknown
      >;
      if (typeof path !== "string" || typeof text !== "string") return null;
      if (text.trim() === "") continue;

      limpos.push({
        path,
        text: text.trim().slice(0, 4000),
        sources: Array.isArray(sources)
          ? sources.filter((f): f is string => typeof f === "string")
          : [],
        ...(typeof editedAt === "string" ? { editedAt } : {}),
        ...(typeof confirmedAt === "string" ? { confirmedAt } : {}),
      });
    }

    if (limpos.length > 0) secoes.push({ key: key as SecaoChave, statements: limpos });
  }
  return secoes;
}

/**
 * Salva a revisão do profissional — e, se pedido, aprova.
 *
 * As duas coisas juntas de propósito. Separadas, existiria a janela em que a
 * edição foi salva e a aprovação falhou, ou o contrário: aprovar o que estava
 * gravado antes da última edição. Numa transação só, o que foi aprovado é
 * exatamente o que foi revisado.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const corpo = (await request.json().catch(() => null)) as {
    sections?: unknown;
    approve?: unknown;
  } | null;

  const secoes = lerSecoes(corpo?.sections);
  if (secoes === null) {
    return NextResponse.json({ error: "formato inválido" }, { status: 400 });
  }
  const querAprovar = corpo?.approve === true;

  const result = await asCurrentProfessional(async (tx, me) => {
    const [session] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    if (session === undefined) {
      return { status: 404, error: "sessão não encontrada" } as const;
    }

    const [doc] = await tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.sessionId, session.id),
          eq(documents.type, "clinical_note"),
          isNull(documents.approvedAt),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(1);

    if (doc === undefined) {
      return { status: 404, error: "não há nota em rascunho nesta sessão" } as const;
    }

    // Os trechos DESTA sessão. É contra esta lista que as fontes valem —
    // um ID real de outra consulta é tão inválido quanto um inventado.
    const trechos = await tx
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.sessionId, session.id));

    const validos = new Set(trechos.map((t) => t.id));
    const saneadas = secoes.map((s) => ({
      key: s.key,
      statements: s.statements.map((a) => ({
        ...a,
        sources: a.sources.filter((f) => validos.has(f)),
      })),
    }));

    const segmentos = trechos.map((t) => ({
      id: t.id,
      speakerLabel: t.speakerLabel,
      role: t.role,
      roleSource: t.roleSource,
      startMs: t.startMs,
      endMs: t.endMs,
      text: t.text,
      confidence: t.confidence,
    }));

    const check = checkApproval(allStatements(saneadas), segmentos);

    if (querAprovar && !check.ok) {
      return {
        status: 409,
        error:
          `${check.pending.length} ${check.pending.length === 1 ? "afirmação continua" : "afirmações continuam"} ` +
          `sem âncora no áudio. Corrija, remova ou assuma cada uma antes de aprovar.`,
        pending: check.pending,
      } as const;
    }

    const conteudoAntigo = doc.content as Record<string, unknown>;

    await tx
      .update(documents)
      .set({
        content: { ...conteudoAntigo, sections: saneadas },
        updatedAt: new Date(),
        ...(querAprovar ? { approvedAt: new Date(), approvedBy: me.id } : {}),
      })
      .where(eq(documents.id, doc.id));

    // Aprovar a nota encerra a sessão. É a transição que transforma trabalho
    // de máquina em registro assinado por uma pessoa.
    if (querAprovar) {
      await tx
        .update(sessions)
        .set({ status: "approved" })
        .where(eq(sessions.id, session.id));
    }

    return { status: 200, approved: querAprovar, pending: check.pending } as const;
  });

  if (result === null || result === undefined) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }

  const { status, ...body } = result;
  return NextResponse.json(body, { status });
}
