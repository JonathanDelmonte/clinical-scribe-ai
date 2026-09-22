import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";
import { auditarExportacao, exportarDados } from "@/lib/lgpd";

export const dynamic = "force-dynamic";

/**
 * Portabilidade — LGPD Art. 18, V.
 *
 * Um JSON com tudo o que é do profissional, legível por máquina e por gente.
 * Roda sob RLS com a identidade dele: a exportação não alcança nada que ele já
 * não pudesse ler pela interface.
 */
export async function GET() {
  const resultado = await asCurrentProfessional(async (tx, me) => {
    const dados = await exportarDados(tx, me);
    await auditarExportacao(tx, dados);
    return dados;
  });

  if (resultado === null) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const dia = new Date().toISOString().slice(0, 10);

  return new Response(JSON.stringify(resultado, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="consulta-viva_meus-dados_${dia}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
