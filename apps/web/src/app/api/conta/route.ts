import { NextResponse } from "next/server";
import { z } from "zod";

import { currentProfessional } from "@/lib/auth";
import { encerrarSessao } from "@/lib/auth/session";
import { excluirConta } from "@/lib/lgpd";

export const dynamic = "force-dynamic";

/** O que a pessoa precisa digitar. Maiúsculas, sem acento, difícil de errar. */
export const PALAVRA_DE_CONFIRMACAO = "EXCLUIR";

const schema = z.object({ confirmacao: z.string() });

/**
 * Eliminação — LGPD Art. 18, VI.
 *
 * Exige a palavra digitada, e não um clique: é a ação mais destrutiva do
 * produto, não tem desfazer, e apaga registro clínico. Um diálogo de "tem
 * certeza?" com dois botões é clicado no automático; digitar uma palavra
 * obriga a pessoa a parar.
 *
 * Não existe período de arrependimento. Uma conta "excluída" que continua no
 * banco por trinta dias não foi excluída — e a LGPD fala de eliminação, não de
 * ocultação. Em troca, a tela ao lado insiste na exportação antes, e diz o que
 * a Resolução CFM 1.821/2007 espera sobre guarda de prontuário.
 */
export async function DELETE(request: Request) {
  const me = await currentProfessional().catch(() => null);
  if (me === null) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.confirmacao !== PALAVRA_DE_CONFIRMACAO) {
    return NextResponse.json(
      { error: `digite ${PALAVRA_DE_CONFIRMACAO} para confirmar` },
      { status: 400 },
    );
  }

  const resultado = await excluirConta(me);

  // A sessão morre junto. Sem isto, o cookie continuaria válido apontando para
  // um `auth_user_id` que não resolve mais — e toda página quebraria de um
  // jeito que parece bug em vez de "sua conta não existe mais".
  await encerrarSessao();

  return NextResponse.json({ ok: true, ...resultado });
}
