import { canChooseEngine, PLAN_DEFAULT_ENGINE, type Account } from "@scribe/core";
import { patients, sessions } from "@scribe/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PatientDetails } from "@/components/PatientDetails";
import { SessionRecorder } from "@/components/SessionRecorder";
import { asCurrentUser, exigirProfissional } from "@/lib/auth";
import { dataParaFormulario } from "@/lib/patients";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "rascunho",
  recording: "gravando",
  uploaded: "na fila",
  transcribing: "transcrevendo",
  generating: "gerando nota",
  ready_for_review: "pronta para revisão",
  approved: "aprovada",
  failed: "falhou",
};

export default async function PatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const me = await exigirProfissional();

  const data = await asCurrentUser(async (tx) => {
    // Sob RLS: paciente de outro profissional não é encontrado, ponto.
    const [patient] = await tx
      .select()
      .from(patients)
      .where(eq(patients.id, id))
      .limit(1);
    if (patient === undefined) return null;

    const rows = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.patientId, patient.id))
      .orderBy(desc(sessions.createdAt));

    return { patient, sessions: rows };
  }).catch(() => null);

  if (data === null || data === undefined) notFound();

  const { patient, sessions: sessionRows } = data;
  const account: Account = {
    role: me.role,
    plan: me.plan,
    preferredEngine: me.preferredEngine,
  };

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <nav className="mb-6 text-sm text-muted">
        <Link href="/" className="hover:text-ink">
          ← pacientes
        </Link>
      </nav>

      <h1 className="text-2xl font-semibold tracking-tight">{patient.name}</h1>
      {patient.deletedAt !== null && (
        <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
          Paciente arquivado. As consultas continuam aqui; ele não aparece mais na
          lista.
        </p>
      )}

      <section className="mt-6">
        <PatientDetails
          id={patient.id}
          nome={patient.name}
          nascimento={dataParaFormulario(patient.birthDate)}
          observacoes={patient.notes ?? ""}
          sessoes={sessionRows.length}
        />
      </section>

      <section className="mt-8">
        <h2 className="mb-4 text-xs font-medium tracking-widest text-muted uppercase">
          Nova sessão
        </h2>
        <SessionRecorder
          patientId={patient.id}
          canChooseEngine={canChooseEngine(account)}
          defaultEngine={PLAN_DEFAULT_ENGINE[me.plan]}
        />
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-xs font-medium tracking-widest text-muted uppercase">
          Sessões ({sessionRows.length})
        </h2>
        {sessionRows.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma sessão gravada ainda.</p>
        ) : (
          <ul className="space-y-2">
            {sessionRows.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sessoes/${s.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-4 py-3 transition-colors hover:border-accent"
                >
                  <span className="text-sm">{s.createdAt.toLocaleString("pt-BR")}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      s.status === "failed"
                        ? "bg-red-500/15 text-red-500"
                        : s.status === "ready_for_review" || s.status === "approved"
                          ? "bg-accent/15 text-accent"
                          : "text-muted"
                    }`}
                  >
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                  {s.engineUsed !== null && (
                    <span className="text-xs text-muted">motor {s.engineUsed}</span>
                  )}
                  <span className="ml-auto text-sm text-muted">abrir →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
