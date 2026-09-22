import { patients } from "@scribe/db";
import { and, desc, ilike, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ACOES, auditar } from "@/lib/audit";
import { asCurrentProfessional } from "@/lib/auth";
import { padraoDeBusca } from "@/lib/patients";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const padrao = padraoDeBusca(new URL(request.url).searchParams.get("q") ?? "");

  const rows = await asCurrentProfessional((tx) =>
    // Sem `where professional_id = ...`: a política RLS já reduziu a tabela
    // aos pacientes deste profissional. Um filtro aqui seria redundante — e
    // pior, daria a impressão de que o isolamento depende dele.
    tx
      .select()
      .from(patients)
      .where(
        padrao === null
          ? isNull(patients.deletedAt)
          : and(isNull(patients.deletedAt), ilike(patients.name, padrao)),
      )
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
        // `T00:00:00Z` explícito: sem o fuso, o construtor de `Date` lê a
        // string curta como meia-noite LOCAL, e a coluna `date` guarda o dia
        // anterior em todo o Brasil.
        birthDate: parsed.data.birthDate
          ? new Date(`${parsed.data.birthDate}T00:00:00Z`)
          : null,
        notes: parsed.data.notes ?? null,
      })
      .returning();

    if (row !== undefined) {
      // Só o ID. O nome do paciente é dado clínico e não entra na trilha.
      await auditar(tx, {
        acao: ACOES.pacienteCriado,
        entidade: "patients",
        entidadeId: row.id,
      });
    }
    return row;
  });

  if (created === null || created === undefined) {
    return NextResponse.json({ error: "não foi possível criar" }, { status: 400 });
  }
  return NextResponse.json({ patient: created }, { status: 201 });
}
