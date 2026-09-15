import { PLAN_DEFAULT_ENGINE, resolveEngine, type Account } from "@scribe/core";
import { patients } from "@scribe/db";
import { desc, isNull } from "drizzle-orm";
import Link from "next/link";

import { NewPatientForm } from "@/components/NewPatientForm";
import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await asCurrentProfessional(async (tx, me) => {
    const rows = await tx
      .select()
      .from(patients)
      .where(isNull(patients.deletedAt))
      .orderBy(desc(patients.createdAt));
    return { me, rows };
  }).catch(() => null);

  if (data === null) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <h1 className="text-xl font-semibold">Banco não configurado</h1>
        <p className="mt-3 text-muted">
          Rode <code className="text-ink">pnpm db:up</code>,{" "}
          <code className="text-ink">pnpm db:migrate</code> e{" "}
          <code className="text-ink">pnpm db:seed</code>.
        </p>
      </main>
    );
  }

  const { me, rows } = data;
  const account: Account = {
    role: me.role,
    plan: me.plan,
    preferredEngine: me.preferredEngine,
  };
  const decision = resolveEngine(account);

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{me.name}</h1>
        <p className="mt-1 text-sm text-muted">
          cargo <strong className="text-ink">{me.role}</strong> · plano{" "}
          <strong className="text-ink">{me.plan}</strong> · motor{" "}
          <strong className="text-ink">{decision.engine}</strong>{" "}
          <span className="text-muted">
            ({decision.reason === "plan-default" ? "padrão do plano" : "escolha do dev"}
            )
          </span>
        </p>
        {me.role === "developer" && (
          <p className="mt-1 text-xs text-muted">
            Como desenvolvedor você escolhe o motor em cada sessão. No plano {me.plan} o
            padrão seria <code>{PLAN_DEFAULT_ENGINE[me.plan]}</code>.
          </p>
        )}
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-medium tracking-widest text-muted uppercase">
          Novo paciente
        </h2>
        <NewPatientForm />
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium tracking-widest text-muted uppercase">
          Pacientes ({rows.length})
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">
            Nenhum paciente ainda. Crie o primeiro acima.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/pacientes/${p.id}`}
                  className="flex items-center gap-3 rounded-lg border border-line px-4 py-3 transition-colors hover:border-accent"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-auto text-sm text-muted">abrir pasta →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
