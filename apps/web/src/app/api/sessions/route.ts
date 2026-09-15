import { resolveEngine, type Account } from "@scribe/core";
import { patients, sessions } from "@scribe/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  patientId: z.string().uuid(),
  objectiveText: z.string().max(2000).optional(),
  /** Só respeitado para o cargo `developer` — ver resolveEngine(). */
  engineChoice: z.enum(["local", "cloud"]).nullable().optional(),
});

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "dados inválidos" },
      { status: 400 },
    );
  }

  const result = await asCurrentProfessional(async (tx, me) => {
    // O paciente é buscado sob RLS: se não for deste profissional, a consulta
    // simplesmente não o encontra. Não existe caminho para criar sessão sobre
    // o paciente de outra pessoa, nem por ID adivinhado.
    const [patient] = await tx
      .select()
      .from(patients)
      .where(eq(patients.id, parsed.data.patientId))
      .limit(1);

    if (patient === undefined) return { error: "paciente não encontrado" } as const;

    const account: Account = {
      role: me.role,
      plan: me.plan,
      preferredEngine: me.preferredEngine,
    };
    const decision = resolveEngine(account, parsed.data.engineChoice ?? null);

    const [session] = await tx
      .insert(sessions)
      .values({
        professionalId: me.id,
        patientId: patient.id,
        status: "draft",
        startedAt: new Date(),
        objectiveText: parsed.data.objectiveText ?? null,
        engineChoice: parsed.data.engineChoice ?? null,
        // Registro de ciência da gravação. A base legal do tratamento é a
        // tutela da saúde (LGPD Art. 11, II, "f"), mas a transparência é
        // obrigatória: o paciente precisa estar ciente de que está sendo
        // gravado. A interface exibe isso antes de habilitar o botão.
        consentRecordedAt: new Date(),
        consentMethod: "verbal-in-person",
      })
      .returning();

    return { session, decision } as const;
  });

  if (result === null) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json(
    { session: result.session, engine: result.decision },
    { status: 201 },
  );
}
