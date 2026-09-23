import { NextResponse } from "next/server";

import { limitarPorProfissional } from "@/lib/limites";
import { cancelarProcessamento } from "@/lib/sessoes";

export const dynamic = "force-dynamic";

/**
 * Interrompe o processamento de uma consulta.
 *
 * A contrapartida de `POST /processar`: uma põe na fila, a outra tira. As
 * duas deixam o áudio onde está, e é isso que torna cancelar uma decisão
 * barata — se foi engano, `processar` desfaz.
 *
 * Quem cancela costuma cancelar porque errou o arquivo, e quem errou o
 * arquivo vai querer apagar a consulta logo em seguida. As duas coisas são
 * rotas separadas de propósito: juntar "pare" com "destrua" numa ação só
 * transformaria um clique em arrependimento.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const barrado = await limitarPorProfissional("upload");
  if (barrado !== null) return barrado;

  const resultado = await cancelarProcessamento(id);

  if (resultado === null) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  if ("error" in resultado) {
    return NextResponse.json(
      { error: resultado.error },
      { status: resultado.error === "sessão não encontrada" ? 404 : 409 },
    );
  }

  return NextResponse.json(resultado);
}
