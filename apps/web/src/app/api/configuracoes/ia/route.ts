import { cifrar, cofreDisponivel, dicaDaChave } from "@scribe/auth";
import { professionals } from "@scribe/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { ACOES, auditar } from "@/lib/audit";
import { asCurrentProfessional } from "@/lib/auth";
import { FORNECEDORES, verificarChave } from "@/lib/ia/fornecedores";

export const dynamic = "force-dynamic";

/**
 * Guarda a chave de IA do profissional.
 *
 * As cinco regras do ADR-0003 estão todas aqui, e nenhuma é opcional:
 *
 *  1. A chave é **cifrada** antes de tocar o banco — `SEGREDO_MESTRE` fica
 *     fora dele, então um dump não entrega credencial de ninguém.
 *  2. A chave **nunca volta** para o navegador: a resposta leva só a dica com
 *     os quatro últimos caracteres.
 *  3. A chave **nunca entra em log**, nem em erro, nem em auditoria.
 *  4. A chave é **verificada** com uma chamada barata ao fornecedor antes de
 *     ser salva — uma chave errada falha aqui, com a pessoa olhando, e não no
 *     meio de uma consulta.
 *  5. A **política de dados** continua valendo: nível gratuito segue recusado
 *     para paciente real, mesmo sendo a chave do cliente.
 */
export async function PATCH(request: Request) {
  if (!cofreDisponivel()) {
    return NextResponse.json(
      {
        error:
          "O servidor não está preparado para guardar chaves com segurança " +
          "(SEGREDO_MESTRE ausente). Avise quem administra a instalação.",
      },
      { status: 503 },
    );
  }

  const corpo = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  const fornecedor = typeof corpo?.["provider"] === "string" ? corpo["provider"] : "";
  const chave = typeof corpo?.["key"] === "string" ? corpo["key"].trim() : "";
  const modelo = typeof corpo?.["model"] === "string" ? corpo["model"].trim() : "";
  const baseUrl = typeof corpo?.["baseUrl"] === "string" ? corpo["baseUrl"].trim() : "";
  const semTreino = corpo?.["contractual"] === true;

  const spec = FORNECEDORES.find((f) => f.id === fornecedor);
  if (spec === undefined) {
    return NextResponse.json({ error: "fornecedor desconhecido" }, { status: 400 });
  }
  if (chave === "") {
    return NextResponse.json({ error: "cole a chave" }, { status: 400 });
  }
  if (modelo === "") {
    return NextResponse.json({ error: "informe o modelo" }, { status: 400 });
  }

  /**
   * URL própria só por HTTPS.
   *
   * Sem isto, um endereço `http://` mandaria a chave e a transcrição da
   * consulta em texto puro pela rede. Quem configura um endereço próprio
   * raramente pensa nisso; o código precisa pensar.
   */
  if (baseUrl !== "") {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      return NextResponse.json({ error: "endereço inválido" }, { status: 400 });
    }
    if (url.protocol !== "https:") {
      return NextResponse.json(
        { error: "o endereço precisa começar com https://" },
        { status: 400 },
      );
    }
  }

  // Regra 4: conferir antes de guardar.
  const verificacao = await verificarChave(spec, chave, modelo, baseUrl);
  if (!verificacao.ok) {
    return NextResponse.json({ error: verificacao.motivo }, { status: 400 });
  }

  const resultado = await asCurrentProfessional(async (tx, me) => {
    await tx
      .update(professionals)
      .set({
        llmProvider: spec.id,
        llmModel: modelo,
        llmKeyCipher: cifrar(chave),
        llmKeyHint: dicaDaChave(chave),
        llmBaseUrl: baseUrl === "" ? null : baseUrl,
        llmDataPolicy: semTreino ? "contractual" : "training",
        llmVerifiedAt: new Date(),
      })
      .where(eq(professionals.id, me.id));

    // O fornecedor e a política, nunca a chave nem a dica dela.
    await auditar(tx, {
      acao: ACOES.chaveIaAlterada,
      entidade: "professionals",
      entidadeId: me.id,
      metadados: {
        fornecedor: spec.id,
        politica: semTreino ? "contractual" : "training",
      },
    });

    return { ok: true, hint: dicaDaChave(chave), provider: spec.id, model: modelo };
  });

  if (resultado === null || resultado === undefined) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  return NextResponse.json(resultado);
}

/** Remove a chave e volta ao modelo do sistema. */
export async function DELETE() {
  const resultado = await asCurrentProfessional(async (tx, me) => {
    await tx
      .update(professionals)
      .set({
        llmProvider: null,
        llmModel: null,
        llmKeyCipher: null,
        llmKeyHint: null,
        llmBaseUrl: null,
        llmDataPolicy: null,
        llmVerifiedAt: null,
      })
      .where(eq(professionals.id, me.id));

    await auditar(tx, {
      acao: ACOES.chaveIaAlterada,
      entidade: "professionals",
      entidadeId: me.id,
      metadados: { fornecedor: null, politica: null },
    });

    return { ok: true };
  });

  if (resultado === null || resultado === undefined) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  return NextResponse.json(resultado);
}
