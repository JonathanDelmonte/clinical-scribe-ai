import { documents, patients, sessions } from "@scribe/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ExportarDocumento,
  type DocumentoExportavel,
} from "@/components/ExportarDocumento";
import { asCurrentUser, exigirProfissional } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Exportar os documentos de uma consulta.
 *
 * ## Por que esta tela é separada da revisão
 *
 * O lugar natural do botão de exportar é ao lado da nota, na tela de revisão —
 * e essa tela pertence à Trilha A (`SessionView.tsx` está no CODEOWNERS). A
 * divisão de trabalho é explícita sobre o que fazer aqui: descrever o
 * resultado desejado numa issue e seguir trabalhando no resto, em vez de
 * editar um arquivo fechado.
 *
 * Então a exportação existe inteira, por conta própria, alcançável pela pasta
 * do paciente. Quando a Trilha A quiser, o link da tela de revisão para cá é
 * uma linha — ou o componente `ExportarDocumento` é reaproveitado lá dentro,
 * que é para isso que ele é um componente e não um pedaço desta página.
 */
export default async function Exportar({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await exigirProfissional();

  const dados = await asCurrentUser(async (tx) => {
    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    if (session === undefined) return null;

    const [patient] = await tx
      .select({ id: patients.id, name: patients.name })
      .from(patients)
      .where(eq(patients.id, session.patientId))
      .limit(1);

    const docs = await tx
      .select({
        id: documents.id,
        type: documents.type,
        content: documents.content,
        approvedAt: documents.approvedAt,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(eq(documents.sessionId, session.id))
      .orderBy(desc(documents.createdAt));

    return { session, patient: patient ?? null, docs };
  }).catch(() => null);

  if (dados === null || dados === undefined) notFound();

  const { session, patient, docs } = dados;

  /**
   * A nota clínica aparece uma vez só, na versão mais recente.
   *
   * Gerar de novo insere outra linha em vez de sobrescrever — é o histórico
   * que permite investigar uma regressão depois de mudar o prompt. Mas na tela
   * de exportar, três versões da mesma nota seriam três botões que produzem
   * documentos parecidos e diferentes, e escolher errado é publicar a versão
   * errada de um registro clínico.
   */
  const notas = docs.filter((d) => d.type === "clinical_note");
  const objetivos = docs.filter((d) => d.type !== "clinical_note");

  const exportaveis: DocumentoExportavel[] = [];

  const nota = notas[0];
  if (nota !== undefined) {
    exportaveis.push({
      chave: "nota",
      titulo: "Nota clínica",
      aprovado: nota.approvedAt !== null,
      criadoEm: nota.createdAt.toISOString(),
    });
  }

  for (const d of objetivos) {
    const titulo =
      typeof d.content === "object" &&
      d.content !== null &&
      "title" in d.content &&
      typeof (d.content as { title: unknown }).title === "string"
        ? String((d.content as { title: string }).title)
        : d.type;

    exportaveis.push({
      chave: d.id,
      titulo,
      aprovado: d.approvedAt !== null,
      criadoEm: d.createdAt.toISOString(),
    });
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <nav className="mb-6 flex flex-wrap gap-4 text-sm text-muted">
        <Link href={`/sessoes/${session.id}`} className="hover:text-ink">
          ← voltar à consulta
        </Link>
        {patient !== null && (
          <Link href={`/pacientes/${patient.id}`} className="hover:text-ink">
            pasta de {patient.name}
          </Link>
        )}
      </nav>

      <h1 className="text-2xl font-semibold tracking-tight">Exportar</h1>
      <p className="mt-1 mb-8 text-sm text-muted">
        Consulta de {(session.startedAt ?? session.createdAt).toLocaleString("pt-BR")}
        {patient === null ? "" : ` · ${patient.name}`}
      </p>

      <ExportarDocumento sessionId={session.id} documentos={exportaveis} />

      {notas.length > 1 && (
        <p className="mt-4 text-xs text-muted">
          Esta consulta tem {notas.length} versões da nota. A exportação usa sempre a
          mais recente — as anteriores ficam guardadas como histórico.
        </p>
      )}

      <div className="mt-10 rounded-lg border border-line px-4 py-3 text-xs text-muted">
        <p>
          <strong className="text-ink">Por que exportar, e não guardar aqui.</strong>{" "}
          Este produto é um assistente de documentação: ele produz a nota e a entrega
          para o prontuário que você já usa e que tem validade jurídica. O PDF traz sua
          identificação e sua assinatura, e declara que foi produzido com auxílio de IA
          e revisado por você — mas não é assinatura digital ICP-Brasil.
        </p>
      </div>
    </main>
  );
}
