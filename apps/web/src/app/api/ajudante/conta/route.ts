import { helpers } from "@scribe/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { comoServico } from "@/lib/ajudante/conta";
import { rotaDoAjudante } from "@/lib/ajudante/rota";
import { ACOES, auditarComIdentidade } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * O ajudante se desconecta da conta ("Desconectar", no menu da bandeja, ou ao
 * desinstalar). O token deixa de valer na hora, e as consultas desta pessoa
 * voltam para a estação.
 */
export async function DELETE(request: Request) {
  return rotaDoAjudante(request, async (ajudante) => {
    await comoServico((tx) =>
      tx
        .delete(helpers)
        .where(
          and(
            eq(helpers.id, ajudante.id),
            eq(helpers.professionalId, ajudante.professionalId),
          ),
        ),
    );
    await auditarComIdentidade(ajudante.authUserId, {
      acao: ACOES.ajudanteDesconectado,
      entidade: "helpers",
      entidadeId: ajudante.id,
      metadados: { origem: "ajudante" },
    });
    return NextResponse.json({ ok: true });
  });
}
