import { swapRoles, type SpeakerAssignment } from "@scribe/core";
import { sessions, transcriptSegments } from "@scribe/db";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Inverte profissional e paciente.
 *
 * A identificação automática acerta na maioria das vezes e erra em alguma —
 * áudio ruim, consulta atípica, profissional que fala pouco. Numa ferramenta
 * clínica nenhuma decisão automática pode ser a palavra final: a nota sairia
 * com a queixa atribuída ao médico e a conduta ao paciente, com aparência de
 * correção.
 *
 * A correção é uma inversão, não uma escolha livre, porque o erro possível é
 * um só: trocar os dois. Um botão que inverte é mais rápido e menos sujeito a
 * engano que um seletor por falante.
 */
export async function POST(
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

    if (session === undefined) return { error: "sessão não encontrada" } as const;

    const atual = (session.roleAssignment ?? []) as SpeakerAssignment[];
    if (atual.length === 0) {
      return { error: "esta sessão não tem papéis identificados" } as const;
    }

    const invertido = swapRoles(atual);

    // Uma única instrução troca os dois papéis ao mesmo tempo. Fazer em duas
    // (professional→patient, depois patient→professional) transformaria todos
    // em paciente: a segunda encontraria as linhas que a primeira acabou de
    // mudar.
    await tx
      .update(transcriptSegments)
      .set({
        role: sql`case
          when ${transcriptSegments.role} = 'professional' then 'patient'::speaker_role
          when ${transcriptSegments.role} = 'patient' then 'professional'::speaker_role
          else ${transcriptSegments.role}
        end`,
        roleSource: "manual",
      })
      .where(eq(transcriptSegments.sessionId, session.id));

    await tx
      .update(sessions)
      .set({ roleAssignment: invertido })
      .where(eq(sessions.id, session.id));

    return { ok: true, assignment: invertido } as const;
  });

  if (result === null) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json(result);
}
