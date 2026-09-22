import { NextResponse } from "next/server";
import { z } from "zod";

import { ACOES, auditarComIdentidade } from "@/lib/audit";
import { criarConta } from "@/lib/auth/accounts";
import { abrirSessao } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const schema = z.object({
  nome: z.string().max(200),
  email: z.string().max(320),
  senha: z.string().max(500),
});

/**
 * Criar conta.
 *
 * A validação de verdade mora em `criarConta`, e não neste schema: o Zod aqui
 * só recusa o que nem chega a ser uma tentativa (campo ausente, tamanho
 * absurdo). Regra de senha e formato de e-mail ficam junto de quem escreve no
 * banco, para que a rota não seja o único lugar que as conhece.
 *
 * Entra direto depois de cadastrar. Pedir para a pessoa digitar de novo o que
 * acabou de digitar é atrito sem ganho — ela já provou que sabe a senha.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "dados inválidos" }, { status: 400 });
  }

  const resultado = await criarConta(parsed.data);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.erro }, { status: 400 });
  }

  await abrirSessao(resultado.authUserId);
  await auditarComIdentidade(resultado.authUserId, {
    acao: ACOES.cadastrar,
    entidade: "auth",
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
