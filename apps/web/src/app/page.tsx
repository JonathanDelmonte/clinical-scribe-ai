import { PLAN_DEFAULT_ENGINE, resolveEngine, type Account } from "@scribe/core";
import { patients, sessions } from "@scribe/db";
import { and, count, desc, eq, ilike, isNull, max, sql } from "drizzle-orm";
import Link from "next/link";

import { NewPatientForm } from "@/components/NewPatientForm";
import { PatientSearch } from "@/components/PatientSearch";
import { asCurrentUser, exigirProfissional } from "@/lib/auth";
import { padraoDeBusca } from "@/lib/patients";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // Redireciona para o login, ou para o onboarding se o perfil estiver
  // incompleto. Daqui para baixo, `me` existe.
  const me = await exigirProfissional();

  const { q } = await searchParams;
  const padrao = padraoDeBusca(q ?? "");

  /**
   * A lista traz consultas e última visita junto, num `left join` agregado.
   *
   * A alternativa — listar pacientes e consultar as sessões de cada um — é o
   * problema N+1 clássico: trinta pacientes viram trinta e uma consultas ao
   * banco, e a tela inicial é a que mais abre no dia.
   *
   * `left` e não `inner`: paciente sem consulta nenhuma precisa aparecer. É
   * justamente quem acabou de ser cadastrado.
   */
  const rows =
    (await asCurrentUser((tx) =>
      tx
        .select({
          id: patients.id,
          name: patients.name,
          createdAt: patients.createdAt,
          sessoes: count(sessions.id),
          ultimaSessao: max(sessions.createdAt),
        })
        .from(patients)
        .leftJoin(sessions, eq(sessions.patientId, patients.id))
        .where(
          padrao === null
            ? isNull(patients.deletedAt)
            : and(isNull(patients.deletedAt), ilike(patients.name, padrao)),
        )
        .groupBy(patients.id)
        // Quem foi atendido por último primeiro, e quem nunca foi logo atrás
        // pela data de cadastro. Ordenar só por cadastro empurraria para o
        // fim da lista exatamente o paciente que acabou de sair da sala.
        .orderBy(
          sql`max(${sessions.createdAt}) desc nulls last`,
          desc(patients.createdAt),
        ),
    ).catch(() => null)) ?? [];

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

      <section className="mb-4">
        <PatientSearch total={rows.length} />
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium tracking-widest text-muted uppercase">
          Pacientes ({rows.length})
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">
            {padrao === null
              ? "Nenhum paciente ainda. Crie o primeiro acima."
              : "Nenhum paciente com esse nome."}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/pacientes/${p.id}`}
                  className="flex items-center gap-3 rounded-lg border border-line px-4 py-3 transition-colors hover:border-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block text-xs text-muted">
                      {p.sessoes === 0
                        ? "sem consultas"
                        : `${p.sessoes} ${p.sessoes === 1 ? "consulta" : "consultas"}`}
                      {p.ultimaSessao !== null &&
                        ` · última em ${new Date(p.ultimaSessao).toLocaleDateString("pt-BR")}`}
                    </span>
                  </span>
                  <span className="text-sm text-muted">abrir →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
