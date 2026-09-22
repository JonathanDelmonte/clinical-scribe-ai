import { documents, jobs, patients, sessions, transcriptSegments } from "@scribe/db";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Estado e transcrição de uma sessão.
 *
 * A página consulta isto em intervalos enquanto o status for de processamento.
 * Polling e não websocket de propósito: uma transcrição leva minutos, então
 * uma consulta a cada poucos segundos custa quase nada e evita uma conexão
 * persistente que precisaria reconectar, autenticar e ser mantida no servidor.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const result = await asCurrentProfessional(async (tx) => {
    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    if (session === undefined) return null;

    const [patient] = await tx
      .select()
      .from(patients)
      .where(eq(patients.id, session.patientId))
      .limit(1);

    const segments = await tx
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.sessionId, session.id))
      .orderBy(asc(transcriptSegments.startMs));

    // A nota mais recente. Gerar de novo insere outra linha em vez de
    // sobrescrever: as versões anteriores são o histórico que permite
    // investigar uma regressão de qualidade depois de mudar o prompt.
    const [note] = await tx
      .select()
      .from(documents)
      .where(
        and(eq(documents.sessionId, session.id), eq(documents.type, "clinical_note")),
      )
      .orderBy(desc(documents.createdAt))
      .limit(1);

    // O status da sessão volta a "ready_for_review" assim que o worker
    // termina, então ele não distingue "sem nota" de "nota a caminho". O job
    // pendente distingue — e é o que mantém o botão desabilitado enquanto o
    // modelo trabalha.
    const [noteJob] = await tx
      .select({ status: jobs.status, error: jobs.lastError })
      .from(jobs)
      .where(and(eq(jobs.sessionId, session.id), eq(jobs.kind, "generate_note")))
      .orderBy(desc(jobs.createdAt))
      .limit(1);

    // Os documentos do objetivo da sessão — receita, encaminhamento, etc.
    // Vários por sessão, ao contrário da nota: o profissional pode pedir a
    // receita E o encaminhamento da mesma consulta.
    const objectives = await tx
      .select()
      .from(documents)
      .where(
        and(eq(documents.sessionId, session.id), ne(documents.type, "clinical_note")),
      )
      .orderBy(desc(documents.createdAt));

    const [objectiveJob] = await tx
      .select({ status: jobs.status, error: jobs.lastError })
      .from(jobs)
      .where(and(eq(jobs.sessionId, session.id), eq(jobs.kind, "generate_objective")))
      .orderBy(desc(jobs.createdAt))
      .limit(1);

    return {
      session,
      patient: patient ?? null,
      segments,
      note: note ?? null,
      noteJob: noteJob ?? null,
      objectives,
      objectiveJob: objectiveJob ?? null,
    };
  });

  if (result === null || result === undefined) {
    return NextResponse.json({ error: "sessão não encontrada" }, { status: 404 });
  }
  return NextResponse.json(result);
}

/**
 * Apaga uma sessão que nunca chegou a ter áudio.
 *
 * Existe por causa de uma consequência do novo fluxo de gravação: a sessão
 * passa a ser criada QUANDO A GRAVAÇÃO COMEÇA, e não quando ela termina. Essa
 * troca é necessária — o registro de ciência precisa carimbar o instante em
 * que o paciente foi informado, que é antes da consulta, não depois — e tem o
 * efeito colateral de deixar uma sessão vazia toda vez que alguém começa a
 * gravar e desiste.
 *
 * O limite é rígido e deliberado: **só apaga o que não tem áudio.** Uma sessão
 * com gravação é registro clínico, e a exclusão de registro clínico é outra
 * coisa, com outra tela e outra confirmação (LGPD Art. 18). Aqui, uma sessão
 * com `audio_path` preenchido é recusada, não importa o status.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const resultado = await asCurrentProfessional(async (tx) => {
    const [session] = await tx
      .select({ id: sessions.id, audioPath: sessions.audioPath })
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    if (session === undefined) return { error: "sessão não encontrada" } as const;
    if (session.audioPath !== null) {
      return { error: "esta sessão tem gravação e não pode ser descartada" } as const;
    }

    await tx.delete(sessions).where(eq(sessions.id, session.id));
    return { ok: true } as const;
  });

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
