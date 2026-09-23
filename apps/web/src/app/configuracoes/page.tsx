import { PLAN_DEFAULT_ENGINE, resolveEngine, type Account } from "@scribe/core";
import { sessions } from "@scribe/db";
import { and, isNotNull, isNull } from "drizzle-orm";
import Link from "next/link";

import { RetencaoDeAudio } from "@/components/RetencaoDeAudio";
import { VoiceEnrollment } from "@/components/VoiceEnrollment";
import { asCurrentProfessional, exigirProfissional } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Espelha AUDIO_RETENTION_DAYS do worker. Só para exibir qual é o padrão. */
const RETENCAO_PADRAO = Number(process.env["AUDIO_RETENTION_DAYS"] ?? 30);

export default async function Configuracoes() {
  const me = await exigirProfissional();

  const account: Account = {
    role: me.role,
    plan: me.plan,
    preferredEngine: me.preferredEngine,
  };
  const decisao = resolveEngine(account);

  /**
   * Quantas consultas perderiam o áudio em cada escolha de retenção.
   *
   * Contado no servidor, antes de a tela aparecer, porque o número é o que
   * transforma "1 dia" de um rótulo abstrato numa consequência concreta. Sem
   * ele, encurtar a retenção é um clique inofensivo até o áudio sumir.
   */
  const OPCOES_DE_DIAS = [0, 1, 7, 30, 90, 365];
  const afetadasPorOpcao = await asCurrentProfessional(async (tx) => {
    const linhas = await tx
      .select({ endedAt: sessions.endedAt })
      .from(sessions)
      .where(and(isNotNull(sessions.audioPath), isNull(sessions.audioDeletedAt)));

    const agora = Date.now();
    return Object.fromEntries(
      OPCOES_DE_DIAS.map((dias) => {
        const corte = agora - dias * 24 * 60 * 60 * 1000;
        const n = linhas.filter(
          (l) => l.endedAt !== null && l.endedAt.getTime() < corte,
        ).length;
        return [dias, n];
      }),
    );
  }).catch(() => ({}));

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <nav className="mb-6 text-sm text-muted">
        <Link href="/" className="hover:text-ink">
          ← pacientes
        </Link>
      </nav>

      <h1 className="mb-8 text-2xl font-semibold tracking-tight">Configurações</h1>

      <VoiceEnrollment enrolledAt={me.voiceEnrolledAt?.toISOString() ?? null} />

      <RetencaoDeAudio
        atual={me.audioRetentionDays}
        padraoDoServidor={RETENCAO_PADRAO}
        afetadasPorOpcao={afetadasPorOpcao ?? {}}
      />

      <section className="mt-6 rounded-lg border border-line px-5 py-4">
        <h2 className="mb-3 font-medium">Conta</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted">nome</dt>
          <dd>{me.name}</dd>
          <dt className="text-muted">e-mail</dt>
          <dd>{me.email ?? "—"}</dd>
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
        <p className="mt-4 flex flex-wrap gap-4">
          <Link href="/bem-vindo" className="text-sm text-accent hover:underline">
            editar perfil e assinatura →
          </Link>
          <Link href="/auditoria" className="text-sm text-accent hover:underline">
            trilha de auditoria →
          </Link>
          <Link
            href="/configuracoes/dados"
            className="text-sm text-accent hover:underline"
          >
            seus dados e exclusão de conta →
          </Link>
        </p>
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
