import { SPEAKER_ROLES, type SpeakerRole } from "@scribe/core";
import { transcriptSegments } from "@scribe/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { ACOES, auditar } from "@/lib/audit";
import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Corrige um trecho da transcrição — o texto, o falante, ou os dois.
 *
 * ## Por que isto existe, além do óbvio
 *
 * O óbvio é que a máquina erra e a pessoa conserta. O que não é óbvio é o
 * segundo efeito: cada conserto produz um par (o que a máquina ouviu, o que
 * era de verdade). Esse par é dado rotulado, gerado pelo uso, sem ninguém
 * pagar por rotulagem — e é com ele que se mede a acurácia real e se ajusta o
 * vocabulário do reconhecimento e os limiares da separação de vozes.
 *
 * Por isso `text_original` e `role_original` são gravados no PRIMEIRO conserto
 * e nunca mais tocados. Editar duas vezes não pode apagar o que a máquina
 * havia dito; se apagasse, o par se perderia e sobraria só o texto final —
 * que não ensina nada.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; segmentId: string }> },
) {
  const { id, segmentId } = await params;

  const corpo = (await request.json().catch(() => null)) as {
    text?: unknown;
    role?: unknown;
  } | null;

  const novoTexto =
    typeof corpo?.text === "string" ? corpo.text.trim().slice(0, 4000) : null;
  const novoPapel =
    typeof corpo?.role === "string" &&
    (SPEAKER_ROLES as readonly string[]).includes(corpo.role)
      ? (corpo.role as SpeakerRole)
      : null;

  if (novoTexto === null && novoPapel === null) {
    return NextResponse.json(
      { error: "envie `text`, `role`, ou os dois" },
      { status: 400 },
    );
  }
  if (novoTexto !== null && novoTexto === "") {
    // Apagar o texto inteiro destruiria a âncora de qualquer afirmação da nota
    // que cite este trecho. Quem quer remover conteúdo remove a afirmação na
    // nota, onde a consequência está visível.
    return NextResponse.json(
      { error: "o texto não pode ficar vazio — corrija, não apague" },
      { status: 400 },
    );
  }

  const resultado = await asCurrentProfessional(async (tx, me) => {
    // Sob RLS, trecho de outro profissional simplesmente não é encontrado.
    const [trecho] = await tx
      .select()
      .from(transcriptSegments)
      .where(
        and(eq(transcriptSegments.id, segmentId), eq(transcriptSegments.sessionId, id)),
      )
      .limit(1);

    if (trecho === undefined) {
      return { status: 404, error: "trecho não encontrado" } as const;
    }

    const primeiroConserto = trecho.correctedAt === null;

    const mudouTexto = novoTexto !== null && novoTexto !== trecho.text;
    const mudouPapel = novoPapel !== null && novoPapel !== trecho.role;

    if (!mudouTexto && !mudouPapel) {
      return { status: 200, changed: false, segment: trecho } as const;
    }

    const [atualizado] = await tx
      .update(transcriptSegments)
      .set({
        ...(mudouTexto ? { text: novoTexto } : {}),
        ...(mudouPapel ? { role: novoPapel, roleSource: "manual" as const } : {}),
        // Só no primeiro conserto. Depois disso o original já está guardado, e
        // sobrescrever apagaria o que a máquina realmente produziu.
        ...(primeiroConserto
          ? { textOriginal: trecho.text, roleOriginal: trecho.role }
          : {}),
        correctedAt: new Date(),
        correctedBy: me.id,
      })
      .where(eq(transcriptSegments.id, segmentId))
      .returning();

    await auditar(tx, {
      acao: ACOES.trechoCorrigido,
      entidade: "transcript_segments",
      entidadeId: segmentId,
      // O QUE mudou, nunca o conteúdo. Guardar o texto antes e depois numa
      // trilha de auditoria colocaria fala de paciente numa tabela que, por
      // desenho, ninguém consegue apagar.
      metadados: { sessao: id, texto: mudouTexto, papel: mudouPapel },
    });

    return { status: 200, changed: true, segment: atualizado } as const;
  });

  if (resultado === null || resultado === undefined) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  const { status, ...body } = resultado;
  return NextResponse.json(body, { status });
}
