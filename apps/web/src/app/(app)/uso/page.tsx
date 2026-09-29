import { PLAN_MONTHLY_MINUTES, type Account } from "@scribe/core";
import Link from "next/link";

import { asCurrentUser, exigirProfissional } from "@/lib/auth";
import { NOME_DO_PLANO } from "@/lib/plano";
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
      <p className="alerta alerta-erro mx-auto max-w-3xl">
        Não foi possível carregar o uso.
      </p>
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
    <div className="mx-auto flex max-w-3xl flex-col gap-7">
      <header className="flex flex-col gap-2">
        <h1 className="titulo-pagina">Uso e plano</h1>
        <p className="text-[15.5px] text-grafite">
          {nomeDoMes(inicioDoMes(agora))} ·{" "}
          {NOME_DO_PLANO[me.plan] ?? `plano ${me.plan}`}
        </p>
      </header>

      {/* ---- o mês ---------------------------------------------------- */}
      <section className="vidro rounded-[26px] px-6 py-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[40px] leading-none font-light tracking-[-0.03em]">
            {formatarMinutos(quota.usados)}
          </span>
          <span className="text-[15px] text-grafite">
            {tetoDoPlano === null
              ? "sem teto no seu plano"
              : `de ${tetoDoPlano} minutos do plano`}
          </span>
          <span className="ml-auto text-[14.5px] text-grafite">
            {formatarReais(custoDoMes)} de custo direto
          </span>
        </div>

        {tetoDoPlano !== null && (
          <>
            <div
              className="mt-5 h-2.5 overflow-hidden rounded-full bg-tinta/[0.07]"
              role="progressbar"
              aria-valuenow={Math.round(usadoPorCento)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Quota do mês"
            >
              <div
                className={`h-full rounded-full ${
                  usadoPorCento >= 100
                    ? "bg-erro"
                    : "bg-gradient-to-r from-[#8fe3d8] to-viva"
                }`}
                style={{ width: `${usadoPorCento}%` }}
              />
            </div>
            {/*
             * Sem saldo (`null`) é quem não tem quota — o cargo de
             * desenvolvedor, explicado logo abaixo. "Restam menos de 1 min"
             * para quem não tem teto seria um alarme falso.
             */}
            {quota.restantes !== null && (
              <p className="legenda mt-2">
                {quota.restantes > 0
                  ? `Restam ${formatarMinutos(quota.restantes)} neste mês.`
                  : "Quota esgotada. Gravações continuam sendo guardadas; o processamento volta no próximo mês."}
              </p>
            )}
          </>
        )}

        {me.role === "developer" && (
          <p className="legenda mt-3">
            Seu cargo é <code>developer</code>: a quota não se aplica a você. O custo
            continua sendo medido.
          </p>
        )}
      </section>

      {/* ---- por tipo --------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="titulo-secao px-1">Onde foi gasto</h2>
        {porTipo.length === 0 ? (
          <p className="px-1 text-[15px] text-grafite">
            {eventos === 0
              ? "Nenhuma consulta processada ainda."
              : "Nada processado neste mês."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {porTipo.map((l) => (
              <li
                key={l.kind}
                className="vidro flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[20px] px-5 py-3.5 text-[14.5px]"
              >
                <span className="font-medium">{rotuloDeTipo(l.kind)}</span>
                <span className="text-nevoa">
                  {l.eventos} {l.eventos === 1 ? "evento" : "eventos"}
                </span>
                {l.minutos > 0 && (
                  <span className="text-nevoa">{formatarMinutos(l.minutos)}</span>
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
          <p className="legenda px-1">
            Transcrição a R$ 0,00: o motor <code>local</code> roda no próprio servidor,
            então o custo dele é fixo (a máquina) e não por minuto. É essa diferença que
            sustenta o plano grátis.
          </p>
        )}
      </section>

      {/* ---- por consulta ------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <h2 className="titulo-secao px-1">Por consulta</h2>
        {porSessao.length === 0 ? (
          <p className="px-1 text-[15px] text-grafite">
            Nenhuma consulta processada neste mês.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {porSessao.map((l) => (
              <li
                key={l.sessionId ?? l.quando.toISOString()}
                className="vidro flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[20px] px-5 py-3.5 text-[14.5px]"
              >
                <span className="text-nevoa">
                  {l.quando.toLocaleDateString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {l.paciente ?? "consulta removida"}
                </span>
                <span className="text-nevoa">{formatarMinutos(l.minutos)}</span>
                <span>{formatarReais(l.centavos)}</span>
                {l.sessionId !== null && (
                  <Link href={`/sessoes/${l.sessionId}`} className="botao-texto">
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
        <section className="flex flex-col gap-3">
          <h2 className="titulo-secao px-1">Meses anteriores</h2>
          <ul className="flex flex-col gap-2">
            {porMes.map((l) => (
              <li
                key={l.inicio.toISOString()}
                className="vidro flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[20px] px-5 py-3.5 text-[14.5px]"
              >
                <span className="min-w-0 flex-1">{nomeDoMes(l.inicio)}</span>
                {/*
                 * `session_id` é anulável — apagar uma consulta deixa o evento
                 * de uso com a origem em branco, de propósito, para que o
                 * custo não desapareça do relatório junto com ela. Mostrar
                 * "0 consultas" ao lado de 210 minutos parece defeito.
                 */}
                {l.sessoes > 0 && (
                  <span className="text-nevoa">
                    {l.sessoes} {l.sessoes === 1 ? "consulta" : "consultas"}
                  </span>
                )}
                <span className="text-nevoa">{formatarMinutos(l.minutos)}</span>
                <span>{formatarReais(l.centavos)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="legenda px-1">
        Os números vêm do que foi realmente processado, medido pelo worker sobre o áudio
        — não do que o dispositivo declarou no envio.
      </p>
    </div>
  );
}
