import { PLAN_DEFAULT_ENGINE, resolveEngine, type Account } from "@scribe/core";
import Link from "next/link";

import { VoiceEnrollment } from "@/components/VoiceEnrollment";
import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Configuracoes() {
  const me = await asCurrentProfessional(
    async (_tx, professional) => professional,
  ).catch(() => null);

  if (me === null || me === undefined) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <p className="text-muted">Não foi possível carregar seu perfil.</p>
      </main>
    );
  }

  const account: Account = {
    role: me.role,
    plan: me.plan,
    preferredEngine: me.preferredEngine,
  };
  const decisao = resolveEngine(account);

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <nav className="mb-6 text-sm text-muted">
        <Link href="/" className="hover:text-ink">
          ← pacientes
        </Link>
      </nav>

      <h1 className="mb-8 text-2xl font-semibold tracking-tight">Configurações</h1>

      <VoiceEnrollment enrolledAt={me.voiceEnrolledAt?.toISOString() ?? null} />

      <section className="mt-6 rounded-lg border border-line px-5 py-4">
        <h2 className="mb-3 font-medium">Conta</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted">nome</dt>
          <dd>{me.name}</dd>
          <dt className="text-muted">especialidade</dt>
          <dd>{me.specialty ?? "—"}</dd>
          <dt className="text-muted">cargo</dt>
          <dd>{me.role}</dd>
          <dt className="text-muted">plano</dt>
          <dd>{me.plan}</dd>
          <dt className="text-muted">motor</dt>
          <dd>
            {decisao.engine}{" "}
            <span className="text-muted">
              (
              {decisao.reason === "plan-default"
                ? `padrão do plano ${me.plan}`
                : "escolha do desenvolvedor"}
              )
            </span>
          </dd>
        </dl>
        {me.role === "developer" && (
          <p className="mt-3 text-xs text-muted">
            Como desenvolvedor você escolhe o motor em cada sessão. No plano {me.plan} o
            padrão é <code>{PLAN_DEFAULT_ENGINE[me.plan]}</code>.
          </p>
        )}
      </section>
    </main>
  );
}
