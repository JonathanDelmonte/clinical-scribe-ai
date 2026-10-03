import { hashDoTokenDoAjudante, lerConvite, novoTokenDoAjudante } from "@scribe/auth";
import { helpers, professionals } from "@scribe/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { lerCorpo } from "@/lib/ajudante/rota";
import { ACOES, auditar } from "@/lib/audit";
import { authConfig } from "@/lib/auth/config";
import { getDb, withProfessional } from "@/lib/db";
import { aplicarLimites, origemDaRequisicao } from "@/lib/limites";
import { codigoPostgres, UNIQUE_VIOLATION } from "@/lib/pg-error";

export const dynamic = "force-dynamic";

const esquema = z.object({
  codigo: z.string().min(1).max(4000),
  verificador: z.string().min(43).max(128),
  versao: z.string().max(40),
  dispositivo: z.enum(["cuda", "cpu"]),
});

/**
 * O ajudante troca o convite (que a pessoa aprovou no navegador) e o
 * verificador (que só ele tem) por um token próprio. Ver `@scribe/auth`,
 * `ajudante.ts`, para o desenho inteiro.
 *
 * Sem cookie, e sem sessão: quem diz de quem é o computador é o convite,
 * assinado pelo site quando a pessoa — já dentro da conta — clicou em
 * "Conectar". O token volta UMA vez, nesta resposta; o banco guarda só o
 * SHA-256 dele.
 */
export async function POST(request: Request) {
  const barrado = aplicarLimites({
    nome: "conexaoDoAjudante",
    chave: await origemDaRequisicao(),
  });
  if (barrado !== null) return barrado;

  const lido = await lerCorpo(request, esquema);
  if (!lido.ok) return lido.resposta;
  const { codigo, verificador, versao, dispositivo } = lido.corpo;

  const convite = lerConvite(codigo, verificador, authConfig.secret);
  if (convite === null) {
    return NextResponse.json(
      {
        erro: "O convite expirou ou não confere. Comece a conexão de novo pelo ajudante.",
      },
      { status: 400 },
    );
  }

  const token = novoTokenDoAjudante();
  let conta: { nome: string; email: string | null } | null;
  try {
    conta = await withProfessional(getDb(), convite.sub, async (tx) => {
      const [eu] = await tx.select().from(professionals).limit(1);
      if (eu === undefined || eu.deletedAt !== null) return null;
      const [criado] = await tx
        .insert(helpers)
        .values({
          professionalId: eu.id,
          tokenHash: hashDoTokenDoAjudante(token),
          pairingNonce: convite.nonce,
          name: convite.nome.slice(0, 100),
          version: versao,
          device: dispositivo,
          ready: false,
          lastSeenAt: new Date(),
        })
        .returning({ id: helpers.id });
      await auditar(tx, {
        acao: ACOES.ajudanteConectado,
        entidade: "helpers",
        entidadeId: criado?.id ?? null,
        metadados: { dispositivo },
      });
      return { nome: eu.name, email: eu.email };
    });
  } catch (erro) {
    // O mesmo convite, usado de novo (um clique duplo, ou alguém repetindo o
    // que interceptou): o nonce é único, e o segundo não conecta nada.
    if (codigoPostgres(erro) === UNIQUE_VIOLATION) {
      return NextResponse.json(
        { erro: "Este convite já foi usado. Comece a conexão de novo pelo ajudante." },
        { status: 409 },
      );
    }
    throw erro;
  }

  if (conta === null) {
    return NextResponse.json({ erro: "Esta conta não existe mais." }, { status: 404 });
  }
  return NextResponse.json({ token, profissional: conta.nome, email: conta.email });
}
