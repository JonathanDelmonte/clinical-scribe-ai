import { helpers } from "@scribe/db";
import { esquemaDoSinal } from "@scribe/processamento";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { comoServico } from "@/lib/ajudante/conta";
import { lerCorpo, rotaDoAjudante } from "@/lib/ajudante/rota";

export const dynamic = "force-dynamic";

/**
 * O sinal de vida do ajudante, a cada 15 segundos.
 *
 * `pronto` é o que tira as consultas desta pessoa da estação: só um motor
 * ligado e aceitando trabalho conta (em pausa pelo Docker, não).
 */
export async function POST(request: Request) {
  return rotaDoAjudante(request, async (ajudante) => {
    const lido = await lerCorpo(request, esquemaDoSinal);
    if (!lido.ok) return lido.resposta;
    await comoServico((tx) =>
      tx
        .update(helpers)
        .set({
          version: lido.corpo.versao,
          device: lido.corpo.dispositivo,
          ready: lido.corpo.pronto,
          lastSeenAt: new Date(),
        })
        .where(
          and(
            eq(helpers.id, ajudante.id),
            eq(helpers.professionalId, ajudante.professionalId),
          ),
        ),
    );
    return NextResponse.json({
      profissional: ajudante.profissional,
      computador: ajudante.nome,
    });
  });
}
