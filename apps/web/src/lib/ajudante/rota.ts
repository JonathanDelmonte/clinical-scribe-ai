import "server-only";

import { NextResponse } from "next/server";
import type { z } from "zod";

import { ajudanteDesconectado, autenticarAjudante, type Ajudante } from "./conta";
import { EntregaInvalida, TarefaPerdida } from "./tarefas";

/**
 * O que toda rota do ajudante faz igual: conferir o token e traduzir os erros
 * do condutor em respostas que o ajudante entende.
 *
 *   401  o computador não está mais conectado — conecte de novo
 *   409  o trabalho não está mais com este computador — largue-o
 *   400  o que o ajudante mandou não serve
 *   500  falha do site — a fila tenta de novo depois
 */
export async function rotaDoAjudante(
  request: Request,
  fn: (ajudante: Ajudante) => Promise<Response>,
): Promise<Response> {
  const ajudante = await autenticarAjudante(request);
  if (ajudante === null) return ajudanteDesconectado();
  try {
    return await fn(ajudante);
  } catch (erro) {
    if (erro instanceof TarefaPerdida) {
      return NextResponse.json({ erro: erro.message, perdida: true }, { status: 409 });
    }
    if (erro instanceof EntregaInvalida) {
      return NextResponse.json({ erro: erro.message }, { status: 400 });
    }
    console.error(
      JSON.stringify({
        nivel: "erro",
        ajudante: ajudante.id,
        mensagem: "rota do ajudante falhou",
        err: erro instanceof Error ? erro.message : String(erro),
      }),
    );
    return NextResponse.json(
      { erro: "O site não conseguiu registrar agora." },
      { status: 500 },
    );
  }
}

/** O corpo JSON conferido pelo esquema — ou a resposta 400 pronta. */
export async function lerCorpo<T>(
  request: Request,
  esquema: z.ZodType<T>,
): Promise<
  | { readonly ok: true; readonly corpo: T }
  | { readonly ok: false; readonly resposta: Response }
> {
  const bruto = await request.json().catch(() => undefined);
  const lido = esquema.safeParse(bruto);
  if (!lido.success) {
    const primeiro = lido.error.issues[0];
    return {
      ok: false,
      resposta: NextResponse.json(
        {
          erro: `corpo inválido em ${primeiro?.path.join(".") || "(raiz)"}: ${primeiro?.message ?? "formato"}`,
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, corpo: lido.data };
}
