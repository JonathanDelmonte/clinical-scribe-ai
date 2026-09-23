import { professionals } from "@scribe/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { ACOES, auditar } from "@/lib/audit";
import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Um ano. Acima disto não é retenção, é arquivo — e exige outra conversa. */
const MAXIMO_DIAS = 365;

/**
 * Por quanto tempo ESTE profissional guarda o áudio das consultas.
 *
 * `null` devolve a decisão ao padrão do servidor, e é diferente de zero: zero
 * é "apague o quanto antes", escolhido de propósito; nulo é "não tenho
 * preferência". Colapsar os dois num valor só tiraria da pessoa a
 * possibilidade de desfazer a escolha sem adivinhar qual era o padrão.
 */
export async function PATCH(request: Request) {
  const corpo = (await request.json().catch(() => null)) as { dias?: unknown } | null;
  const bruto = corpo?.dias;

  const dias =
    bruto === null
      ? null
      : typeof bruto === "number" && Number.isInteger(bruto)
        ? bruto
        : undefined;

  if (dias === undefined) {
    return NextResponse.json(
      { error: "`dias` precisa ser um número inteiro ou null" },
      { status: 400 },
    );
  }
  if (dias !== null && (dias < 0 || dias > MAXIMO_DIAS)) {
    return NextResponse.json(
      { error: `escolha entre 0 e ${MAXIMO_DIAS} dias` },
      { status: 400 },
    );
  }

  const resultado = await asCurrentProfessional(async (tx, me) => {
    await tx
      .update(professionals)
      .set({ audioRetentionDays: dias })
      .where(eq(professionals.id, me.id));

    // Encurtar a retenção apaga gravações. Uma decisão de privacidade que
    // destrói dado precisa deixar rastro de quem a tomou e quando — é
    // exatamente o tipo de pergunta que uma auditoria faz depois.
    await auditar(tx, {
      acao: ACOES.retencaoAlterada,
      entidade: "professionals",
      entidadeId: me.id,
      metadados: { dias },
    });

    return { ok: true, dias };
  });

  if (resultado === null || resultado === undefined) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  return NextResponse.json(resultado);
}
