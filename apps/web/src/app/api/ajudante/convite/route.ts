import { assinarConvite } from "@scribe/auth";
import { NextResponse } from "next/server";

import { lerPedidoDeConexao } from "@/lib/ajudante/conexao";
import { currentProfessional } from "@/lib/auth";
import { authConfig } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

/**
 * A pessoa clicou em "Conectar" na página `/ajudante/conectar`: o site
 * assina o convite e o devolve ao ajudante pelo endereço local do próprio
 * computador — 127.0.0.1, e só ele.
 *
 * O destino é sempre `http://127.0.0.1:<porta>`, montado aqui: nada do que
 * chega na requisição escolhe o host, então isto não vira um redirecionamento
 * aberto. E o convite só abre com o verificador, que nunca saiu do ajudante.
 */
export async function POST(request: Request) {
  // Um formulário de outro site não carrega o cookie (`sameSite: lax`), mas a
  // origem é conferida mesmo assim: esta rota cria uma credencial.
  const origem = request.headers.get("origin");
  if (origem !== null && origem !== new URL(request.url).origin) {
    return NextResponse.json({ erro: "origem não permitida" }, { status: 403 });
  }

  const eu = await currentProfessional();
  if (eu === null) {
    return NextResponse.redirect(new URL("/entrar", request.url), 303);
  }

  const form = await request.formData().catch(() => null);
  const pedido = lerPedidoDeConexao({
    porta: form?.get("porta"),
    estado: form?.get("estado"),
    desafio: form?.get("desafio"),
    nome: form?.get("nome"),
  });
  if (pedido === null) {
    return NextResponse.json({ erro: "Pedido de conexão inválido." }, { status: 400 });
  }

  const codigo = assinarConvite(
    { sub: eu.authUserId, desafio: pedido.desafio, nome: pedido.nome },
    authConfig.secret,
  );
  const destino = new URL(`http://127.0.0.1:${pedido.porta}/conectado`);
  destino.searchParams.set("codigo", codigo);
  destino.searchParams.set("estado", pedido.estado);
  return NextResponse.redirect(destino, 303);
}
