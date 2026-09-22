import { resolveEngine, type Account } from "@scribe/core";
import { patients, sessions } from "@scribe/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { asCurrentProfessional } from "@/lib/auth";
import { CONSENT_METHODS, textoDoConsentimento } from "@/lib/consent";
import { quotaDoMes } from "@/lib/quota";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  patientId: z.string().uuid(),
  objectiveText: z.string().max(2000).optional(),
  /** Só respeitado para o cargo `developer` — ver resolveEngine(). */
  engineChoice: z.enum(["local", "cloud"]).nullable().optional(),
  /**
   * Como a ciência da gravação foi obtida.
   *
   * Obrigatório, e é a mudança que importa nesta rota: antes o servidor
   * gravava `consent_recorded_at` e um método fixo em toda sessão, sem que o
   * cliente precisasse afirmar coisa alguma. A caixa de seleção existia na
   * tela e não chegava até aqui — ou seja, o registro dizia que o paciente foi
   * informado mesmo quando ninguém tinha marcado nada.
   */
  consentMethod: z.enum(CONSENT_METHODS),
});

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const problema = parsed.error.issues[0];
    return NextResponse.json(
      {
        error:
          problema?.path[0] === "consentMethod"
            ? "registre a ciência da gravação antes de iniciar"
            : (problema?.message ?? "dados inválidos"),
      },
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

    /**
     * A quota é conferida aqui só para AVISAR, e de novo no upload para
     * BARRAR.
     *
     * Criar a sessão não custa nada; processar o áudio custa. Recusar a
     * criação seria recusar a gravação de uma consulta que está prestes a
     * acontecer — e uma consulta perdida é pior que uma quota estourada.
     */
    const quota = await quotaDoMes(tx, account);

    const [session] = await tx
      .insert(sessions)
      .values({
        professionalId: me.id,
        patientId: patient.id,
        status: "draft",
        startedAt: new Date(),
        objectiveText: parsed.data.objectiveText ?? null,
        engineChoice: parsed.data.engineChoice ?? null,
        // A base legal do tratamento é a tutela da saúde (LGPD Art. 11, II,
        // "f"), mas a transparência é obrigatória: o paciente precisa estar
        // ciente. O TEXTO vai junto porque o carimbo sozinho não responde
        // "com o que a pessoa concordou".
        consentRecordedAt: new Date(),
        consentMethod: parsed.data.consentMethod,
        consentText: textoDoConsentimento(parsed.data.consentMethod),
      })
      .returning();

    return { session, decision, quota } as const;
  });

  if (result === null) {
    return NextResponse.json({ error: "profissional não encontrado" }, { status: 401 });
  }
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json(
    { session: result.session, engine: result.decision, quota: result.quota },
    { status: 201 },
  );
}
