import { patients } from "@scribe/db";
import { desc, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await asCurrentProfessional((tx) =>
    // Sem `where professional_id = ...`: a política RLS já reduziu a tabela
    // aos pacientes deste profissional. Um filtro aqui seria redundante — e
    // pior, daria a impressão de que o isolamento depende dele.
    tx
      .select()
      .from(patients)
      .where(isNull(patients.deletedAt))
      .orderBy(desc(patients.createdAt)),
  );

  if (rows === null) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  return NextResponse.json({ patients: rows });
}

const createSchema = z.object({
  name: z.string().trim().min(1, "nome é obrigatório").max(200),
  birthDate: z.string().date().optional(),
  notes: z.string().max(5000).optional(),
});

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "dados inválidos" },
      { status: 400 },
    );
  }

  const created = await asCurrentProfessional(async (tx, me) => {
    const [row] = await tx
      .insert(patients)
      .values({
        professionalId: me.id,
        name: parsed.data.name,
        birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : null,
        notes: parsed.data.notes ?? null,
      })
      .returning();
    return row;
  });

  if (created === null || created === undefined) {
    return NextResponse.json({ error: "não foi possível criar" }, { status: 400 });
  }
  return NextResponse.json({ patient: created }, { status: 201 });
}
