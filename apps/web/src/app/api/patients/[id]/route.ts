import { patients, sessions } from "@scribe/db";
import { count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1, "nome é obrigatório").max(200),
  // `null` explícito é diferente de ausente: é "apague o que estava lá".
  birthDate: z.string().date().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "dados inválidos" },
      { status: 400 },
    );
  }

  const resultado = await asCurrentProfessional(async (tx) => {
    // Sob RLS o update em paciente alheio não atinge linha nenhuma — e é isso
    // que `returning()` vazio informa. Não há consulta de permissão antes
    // porque não há caminho em que ela mudaria o resultado.
    const [row] = await tx
      .update(patients)
      .set({
        name: parsed.data.name,
        ...(parsed.data.birthDate !== undefined && {
          birthDate:
            parsed.data.birthDate === null
              ? null
              : new Date(`${parsed.data.birthDate}T00:00:00Z`),
        }),
        ...(parsed.data.notes !== undefined && {
          notes: parsed.data.notes === "" ? null : parsed.data.notes,
        }),
      })
      .where(eq(patients.id, id))
      .returning();

    return row ?? null;
  });

  if (resultado === null || resultado === undefined) {
    return NextResponse.json({ error: "paciente não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ patient: resultado });
}

/**
 * Arquiva o paciente — marca `deleted_at`, não apaga a linha.
 *
 * Apagar de verdade destruiria as consultas gravadas junto (a chave
 * estrangeira de `sessions` é `restrict`, então nem seria possível). E é o
 * comportamento certo mesmo sem a restrição: uma consulta gravada é registro
 * clínico, e registro clínico não some porque alguém saiu da lista de
 * pacientes ativos.
 *
 * Apagar de verdade é outro assunto, com outra tela: LGPD Art. 18, Fase 10.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const resultado = await asCurrentProfessional(async (tx) => {
    const [row] = await tx
      .update(patients)
      .set({ deletedAt: new Date() })
      .where(eq(patients.id, id))
      .returning({ id: patients.id });

    if (row === undefined) return null;

    const [total] = await tx
      .select({ n: count() })
      .from(sessions)
      .where(eq(sessions.patientId, id));

    return { id: row.id, sessoesPreservadas: total?.n ?? 0 };
  });

  if (resultado === null || resultado === undefined) {
    return NextResponse.json({ error: "paciente não encontrado" }, { status: 404 });
  }
  return NextResponse.json(resultado);
}
