import { PLAN_MONTHLY_MINUTES, type Account } from "@scribe/core";
import Link from "next/link";

import { asCurrentUser, exigirProfissional } from "@/lib/auth";
import { inicioDoMes, quotaDoMes } from "@/lib/quota";
import {
  formatarMinutos,
  formatarReais,
  nomeDoMes,
  rotuloDeTipo,
  totalDeEventos,
  usoPorMes,
  usoPorSessao,
  usoPorTipo,
} from "@/lib/uso";

export const dynamic = "force-dynamic";

export default async function Uso() {
  const me = await exigirProfissional();

  const account: Account = {
    role: me.role,
    plan: me.plan,
    preferredEngine: me.preferredEngine,
  };

  const agora = new Date();

  const dados = await asCurrentUser(async (tx) => ({
    quota: await quotaDoMes(tx, account, agora),
    porTipo: await usoPorTipo(tx, agora),
    porSessao: await usoPorSessao(tx, agora),
    porMes: await usoPorMes(tx),
    eventos: await totalDeEventos(tx),
  })).catch(() => null);

  if (dados === null || dados === undefined) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <p className="text-muted">Não foi possível carregar o uso.</p>
      </main>
    );
  }

  const { quota, porTipo, porSessao, eventos } = dados;

  // O mês corrente já tem o próprio cartão no topo; repeti-lo numa lista
  // chamada "meses anteriores" é uma contradição na mesma tela.
  const inicioDesteMes = inicioDoMes(agora).getTime();
  const porMes = dados.porMes.filter((l) => l.inicio.getTime() < inicioDesteMes);

  const tetoDoPlano = PLAN_MONTHLY_MINUTES[me.plan];
  const custoDoMes = porTipo.reduce((soma, l) => soma + l.centavos, 0);
  const usadoPorCento =
    tetoDoPlano === null ? 0 : Math.min(100, (quota.usados / tetoDoPlano) * 100);

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <nav className="mb-6 text-sm text-muted">
        <Link href="/" className="hover:text-ink">
          ← pacientes
        </Link>
      </nav>

      <h1 className="text-2xl font-semibold tracking-tight">Uso e custo</h1>
      <p className="mt-1 mb-8 text-sm text-muted">
        {nomeDoMes(inicioDoMes(agora))} · plano {me.plan}
      </p>

      {/* ---- o mês ---------------------------------------------------- */}
      <section className="rounded-lg border border-line px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-2xl font-semibold">
            {formatarMinutos(quota.usados)}
          </span>
          <span className="text-sm text-muted">
            {tetoDoPlano === null
              ? "sem teto no seu plano"
              : `de ${tetoDoPlano} minutos do plano`}
          </span>
          <span className="ml-auto text-sm text-muted">
            {formatarReais(custoDoMes)} de custo direto
          </span>
        </div>

        {tetoDoPlano !== null && (
          <>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuenow={Math.round(usadoPorCento)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Quota do mês"
            >
              <div
                className={`h-full rounded-full ${
                  usadoPorCento >= 100 ? "bg-red-500" : "bg-accent"
                }`}
                style={{ width: `${usadoPorCento}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              {quota.restantes === null || quota.restantes > 0
                ? `Restam ${formatarMinutos(quota.restantes ?? 0)} neste mês.`
                : "Quota esgotada. Gravações continuam sendo guardadas; o processamento volta no próximo mês."}
            </p>
          </>
        )}

        {me.role === "developer" && (
          <p className="mt-2 text-xs text-muted">
            Seu cargo é <code>developer</code>: a quota não se aplica a você. O custo
            continua sendo medido.
          </p>
        )}
      </section>

      {/* ---- por tipo --------------------------------------------------- */}
      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium tracking-widest text-muted uppercase">
          Onde foi gasto
        </h2>
        {porTipo.length === 0 ? (
          <p className="text-sm text-muted">
            {eventos === 0
              ? "Nenhuma consulta processada ainda."
              : "Nada processado neste mês."}
          </p>
        ) : (
          <ul className="space-y-2">
            {porTipo.map((l) => (
              <li
                key={l.kind}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line px-4 py-3 text-sm"
              >
                <span className="font-medium">{rotuloDeTipo(l.kind)}</span>
                <span className="text-muted">
                  {l.eventos} {l.eventos === 1 ? "evento" : "eventos"}
                </span>
                {l.minutos > 0 && (
                  <span className="text-muted">{formatarMinutos(l.minutos)}</span>
                )}
                <span className="ml-auto">{formatarReais(l.centavos)}</span>
              </li>
            ))}
          </ul>
        )}

        {/*
         * O motor local custa zero por minuto, e isso não é um dado faltando:
         * é a margem do plano grátis aparecendo na conta. Sem esta frase, uma
         * coluna de R$ 0,00 parece instrumentação quebrada.
         */}
        {porTipo.some((l) => l.kind === "asr" && l.centavos === 0 && l.minutos > 0) && (
          <p className="mt-3 text-xs text-muted">
            Transcrição a R$ 0,00: o motor <code>local</code> roda no próprio servidor,
            então o custo dele é fixo (a máquina) e não por minuto. É essa diferença que
            sustenta o plano grátis.
          </p>
        )}
      </section>

      {/* ---- por consulta ------------------------------------------------ */}
      <section className="mt-8">
        <h2 className="mb-3 text-xs font-medium tracking-widest text-muted uppercase">
          Por consulta
        </h2>
        {porSessao.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma consulta processada neste mês.</p>
        ) : (
          <ul className="space-y-2">
            {porSessao.map((l) => (
              <li
                key={l.sessionId ?? l.quando.toISOString()}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line px-4 py-3 text-sm"
              >
                <span className="text-muted">
                  {l.quando.toLocaleDateString("pt-BR")}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {l.paciente ?? "consulta removida"}
                </span>
                <span className="text-muted">{formatarMinutos(l.minutos)}</span>
                <span>{formatarReais(l.centavos)}</span>
                {l.sessionId !== null && (
                  <Link
                    href={`/sessoes/${l.sessionId}`}
                    className="text-muted underline underline-offset-2 hover:text-ink"
                  >
                    abrir
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- meses anteriores -------------------------------------------- */}
      {porMes.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-medium tracking-widest text-muted uppercase">
            Meses anteriores
          </h2>
          <ul className="space-y-2">
            {porMes.map((l) => (
              <li
                key={l.inicio.toISOString()}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line px-4 py-3 text-sm"
              >
                <span className="min-w-0 flex-1">{nomeDoMes(l.inicio)}</span>
                {/*
                 * `session_id` é anulável — apagar uma consulta deixa o evento
                 * de uso com a origem em branco, de propósito, para que o
                 * custo não desapareça do relatório junto com ela. Mostrar
                 * "0 consultas" ao lado de 210 minutos parece defeito.
                 */}
                {l.sessoes > 0 && (
                  <span className="text-muted">
                    {l.sessoes} {l.sessoes === 1 ? "consulta" : "consultas"}
                  </span>
                )}
                <span className="text-muted">{formatarMinutos(l.minutos)}</span>
                <span>{formatarReais(l.centavos)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 text-xs text-muted">
        Os números vêm do que foi realmente processado, medido pelo worker sobre o áudio
        — não do que o dispositivo declarou no envio.
      </p>
    </main>
  );
}
