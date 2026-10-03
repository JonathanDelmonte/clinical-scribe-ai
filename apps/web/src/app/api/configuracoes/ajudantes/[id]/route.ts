import { helpers } from "@scribe/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { ACOES, auditar } from "@/lib/audit";
import { asCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Desconecta um computador pelo site — o caminho de quem perdeu o
 * computador, ou o deu a outra pessoa. O token dele deixa de valer na hora, e
 * as consultas voltam para a estação.
 *
 * Sob RLS, como qualquer ajuste: a política de `helpers` só deixa apagar os
 * do próprio profissional.
 */
export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "computador inválido" }, { status: 400 });
  }
  const apagados = await asCurrentUser(async (tx) => {
    const linhas = await tx
      .delete(helpers)
      .where(eq(helpers.id, id))
      .returning({ id: helpers.id });
    if (linhas.length > 0) {
      await auditar(tx, {
        acao: ACOES.ajudanteDesconectado,
        entidade: "helpers",
        entidadeId: id,
        metadados: { origem: "site" },
      });
    }
    return linhas.length;
  });
  if (apagados === null) {
    return NextResponse.json(
      { error: "Sua sessão expirou. Entre de novo." },
      { status: 401 },
    );
  }
  if (apagados === 0) {
    return NextResponse.json(
      { error: "Este computador já não está conectado." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
