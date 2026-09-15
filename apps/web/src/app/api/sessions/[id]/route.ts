import { patients, sessions, transcriptSegments } from "@scribe/db";
import { asc, eq } from "drizzle-orm";
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

    return { session, patient: patient ?? null, segments };
  });

  if (result === null || result === undefined) {
    return NextResponse.json({ error: "sessão não encontrada" }, { status: 404 });
  }
  return NextResponse.json(result);
}
