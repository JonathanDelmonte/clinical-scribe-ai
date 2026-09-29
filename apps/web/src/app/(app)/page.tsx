import { patients, sessions, transcriptSegments } from "@scribe/db";
import { desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import Link from "next/link";

import { Avatar } from "@/components/Avatar";
import { BarraViva } from "@/components/BarraViva";
import { FichaDeEstado } from "@/components/FichaDeEstado";
import { Helice } from "@/components/Helice";
import { IconeAvancar, IconeBusca } from "@/components/Icones";
import { NovaConsultaRapida } from "@/components/NovaConsultaRapida";
import { Orbe } from "@/components/Orbe";
import { asCurrentUser, exigirProfissional } from "@/lib/auth";
import { desenharHelice, type Fala } from "@/lib/helice";
import {
  dataPorExtenso,
  haQuanto,
  periodoDoDia,
  primeiroNome,
  resumoDoDia,
  SAUDACAO,
} from "@/lib/saudacao";

export const dynamic = "force-dynamic";

/** Estados em que o worker ainda está trabalhando. Espelha `lib/sessoes.ts`. */
const EM_ANDAMENTO = ["uploaded", "transcribing", "generating"] as const;

/** Quantas linhas cabem em "Para revisar" antes de a lista virar uma página. */
const LINHAS_PARA_REVISAR = 3;

export default async function Inicio() {
  // Redireciona para o login, ou para o onboarding se o perfil estiver
  // incompleto. Daqui para baixo, `me` existe.
  const me = await exigirProfissional();

  const dados = (await asCurrentUser(async (tx) => {
    const colunas = {
      id: sessions.id,
      patientId: sessions.patientId,
      paciente: patients.name,
      status: sessions.status,
      comecouEm: sessions.startedAt,
      criadaEm: sessions.createdAt,
      durationMs: sessions.durationMs,
    };

    const paraRevisar = await tx
      .select(colunas)
      .from(sessions)
      .innerJoin(patients, eq(patients.id, sessions.patientId))
      .where(eq(sessions.status, "ready_for_review"))
      .orderBy(desc(sessions.createdAt));

    const emAndamento = await tx
      .select(colunas)
      .from(sessions)
      .innerJoin(patients, eq(patients.id, sessions.patientId))
      .where(inArray(sessions.status, [...EM_ANDAMENTO]))
      .orderBy(desc(sessions.createdAt));

    /**
     * Os pacientes, com a última consulta de cada um, num `left join`
     * agregado — a alternativa, uma consulta por paciente, é o N+1 clássico
     * na tela que mais abre no dia.
     *
     * Quem foi atendido por último vem primeiro, e quem nunca foi, logo
     * atrás pela data de cadastro: é quem acabou de ser cadastrado para ser
     * atendido agora.
     */
    const pacientes = await tx
      .select({
        id: patients.id,
        nome: patients.name,
        ultima: max(sessions.createdAt),
        criadoEm: patients.createdAt,
      })
      .from(patients)
      .leftJoin(sessions, eq(sessions.patientId, patients.id))
      .where(isNull(patients.deletedAt))
      .groupBy(patients.id)
      .orderBy(
        sql`max(${sessions.createdAt}) desc nulls last`,
        desc(patients.createdAt),
      )
      .limit(80);

    // A hélice das consultas que aparecem na lista, numa consulta só.
    const visiveis = paraRevisar.slice(0, LINHAS_PARA_REVISAR).map((s) => s.id);
    const falas =
      visiveis.length === 0
        ? []
        : await tx
            .select({
              sessionId: transcriptSegments.sessionId,
              role: transcriptSegments.role,
              startMs: transcriptSegments.startMs,
              endMs: transcriptSegments.endMs,
            })
            .from(transcriptSegments)
            .where(inArray(transcriptSegments.sessionId, visiveis));

    return { paraRevisar, emAndamento, pacientes, falas };
  }).catch(() => null)) ?? {
    paraRevisar: [],
    emAndamento: [],
    pacientes: [],
    falas: [],
  };

  const agora = new Date();
  const periodo = periodoDoDia(agora);

  const falasPorSessao = new Map<string, Fala[]>();
  for (const f of dados.falas) {
    const lista = falasPorSessao.get(f.sessionId) ?? [];
    lista.push(f);
    falasPorSessao.set(f.sessionId, lista);
  }

  const linhas = [
    ...dados.paraRevisar.slice(0, LINHAS_PARA_REVISAR),
    ...dados.emAndamento,
  ].slice(0, LINHAS_PARA_REVISAR);

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span className="inline-flex items-center gap-2.5 text-[14.5px] text-grafite">
          <span
            aria-hidden="true"
            className="size-[7px] rounded-full bg-viva shadow-[0_0_0_4px_rgb(43_181_172/0.16)]"
          />
          {dataPorExtenso(agora)}
        </span>
        <form action="/pacientes" role="search" className="hidden w-[340px] sm:block">
          <label className="vidro-polido flex h-12 items-center gap-2.5 rounded-full px-4.5 text-nevoa focus-within:shadow-[0_0_0_4px_rgb(43_181_172/0.18)]">
            <IconeBusca tamanho={19} />
            <span className="sr-only">Buscar paciente</span>
            <input
              name="q"
              type="search"
              autoComplete="off"
              placeholder="Buscar paciente"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-tinta outline-none placeholder:text-[#66747f]"
            />
          </label>
        </form>
      </div>

      <header className="surgir relative z-10 mt-8 flex flex-col gap-3.5 lg:mt-10">
        <h1 className="text-[clamp(2.75rem,1.6rem+3.6vw,5.25rem)] leading-[0.98] font-light tracking-[-0.045em]">
          {SAUDACAO[periodo]},{" "}
          <span className="font-medium">{primeiroNome(me.name)}</span>.
        </h1>
        <p className="text-[clamp(1rem,0.9rem+0.35vw,1.1875rem)] text-grafite">
          {resumoDoDia(dados.paraRevisar.length, dados.emAndamento.length)}
        </p>
      </header>

      <div className="mt-9 grid grid-cols-1 gap-6 lg:mt-11 xl:grid-cols-12">
        <section
          id="nova-consulta"
          aria-labelledby="titulo-nova-consulta"
          className="vidro surgir surgir-2 relative scroll-mt-6 rounded-[30px] px-6 pt-7 pb-7 sm:px-8 xl:col-span-7"
        >
          {/*
           * O orbe pousa na quina do cartão, meio dentro, meio fora. É a Viva
           * esperando para ouvir — e o único elemento que quebra a grade de
           * propósito, para a tela não ficar dura.
           */}
          <div className="pointer-events-none absolute -top-7 right-4 sm:right-9">
            <Orbe tamanho={108} className="sm:hidden" />
            <Orbe tamanho={176} className="hidden sm:block" />
          </div>

          <div className="flex max-w-[360px] flex-col gap-2.5 sm:max-w-[min(360px,calc(100%_-_196px))]">
            {/*
             * O texto nunca passa por baixo do orbe. No celular o cartão é
             * estreito demais para os dois lado a lado: o título abre espaço
             * para a esfera e quebra em duas linhas, e o parágrafo começa já
             * abaixo dela. Do tablet para cima o bloco inteiro recua a largura
             * da esfera — o cartão muda de largura com a grade, e o recuo é
             * medido nele, não na tela.
             */}
            <h2
              id="titulo-nova-consulta"
              className="pr-[112px] text-[clamp(2rem,1.6rem+1.2vw,2.75rem)] leading-none font-normal tracking-[-0.035em] sm:pr-0"
            >
              Pronta para ouvir
            </h2>
            <p className="text-[15.5px] leading-relaxed text-grafite">
              Escolha a pessoa, toque em começar e converse normalmente. Quando
              terminar, a nota fica pronta para você revisar.
            </p>
          </div>

          <div className="mt-6">
            <NovaConsultaRapida
              pacientes={dados.pacientes.map((p) => ({ id: p.id, nome: p.nome }))}
            />
          </div>
        </section>

        <section
          aria-labelledby="titulo-para-revisar"
          className="vidro surgir surgir-3 flex flex-col gap-3 rounded-[30px] px-4 pt-6 pb-4 xl:col-span-5"
        >
          <div className="flex items-center gap-2.5 px-3">
            <h2 id="titulo-para-revisar" className="titulo-secao">
              Para revisar
            </h2>
            {dados.paraRevisar.length > 0 && (
              <span className="ficha ficha-aviso ficha-contagem">
                {dados.paraRevisar.length}
              </span>
            )}
            <Link
              href="/pacientes"
              className="ml-auto text-sm font-medium text-viva-texto no-underline hover:underline"
            >
              Ver pacientes
            </Link>
          </div>

          {linhas.length === 0 ? (
            <p className="px-3 pt-2 pb-4 text-[15px] leading-relaxed text-grafite">
              Nada por aqui. Quando uma consulta terminar de ser escrita, ela aparece
              nesta lista para você conferir e aprovar.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {linhas.map((s) => {
                const falas = falasPorSessao.get(s.id);
                const desenho =
                  s.status === "ready_for_review" && falas !== undefined
                    ? desenharHelice(falas, {
                        largura: 200,
                        altura: 40,
                        voltas: 6,
                        pontos: 121,
                      })
                    : null;

                return (
                  <li key={s.id}>
                    <Link
                      href={`/sessoes/${s.id}`}
                      className="linha flex min-h-[74px] items-center gap-3 px-3 py-3 text-tinta no-underline"
                    >
                      <Avatar nome={s.paciente} chave={s.patientId} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[15px] font-semibold">
                          {s.paciente}
                        </span>
                        <span className="text-[13px] text-nevoa">
                          {haQuanto(s.comecouEm ?? s.criadaEm, agora).replace(
                            /^./,
                            (c) => c.toLocaleUpperCase("pt-BR"),
                          )}
                          {", "}
                          {(s.comecouEm ?? s.criadaEm).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "America/Sao_Paulo",
                          })}
                          {s.durationMs !== null &&
                            ` · ${Math.max(1, Math.round(s.durationMs / 60_000))} min`}
                        </span>
                        {/* No celular, o estado desce para baixo do nome e o nome não some. */}
                        {desenho === null && (
                          <FichaDeEstado
                            status={s.status}
                            className="mt-1 self-start sm:hidden"
                          />
                        )}
                      </span>
                      {desenho !== null ? (
                        <Helice
                          desenho={desenho}
                          largura={200}
                          altura={40}
                          traco={1.6}
                          className="hidden h-[26px] w-[88px] shrink-0 sm:block"
                        />
                      ) : (
                        <FichaDeEstado
                          status={s.status}
                          className="hidden sm:inline-flex"
                        />
                      )}
                      <IconeAvancar tamanho={18} className="shrink-0 text-nevoa" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {dados.pacientes.length > 0 && (
          <section
            aria-labelledby="titulo-recentes"
            className="vidro surgir surgir-4 flex flex-col gap-4 rounded-[28px] px-5 py-5 sm:flex-row sm:items-center sm:gap-6 sm:py-4 xl:col-span-12"
          >
            <div className="flex shrink-0 items-baseline justify-between gap-4 sm:w-40 sm:flex-col sm:items-start sm:gap-1">
              <h2 id="titulo-recentes" className="text-[15px] font-semibold">
                Vistos por último
              </h2>
              <Link
                href="/pacientes"
                className="text-[13.5px] font-medium text-viva-texto no-underline hover:underline"
              >
                Todos os pacientes
              </Link>
            </div>
            <div aria-hidden="true" className="hidden h-11 w-px bg-line sm:block" />
            <ul className="-mx-2 flex gap-1 overflow-x-auto pb-1 sm:mx-0 sm:pb-0">
              {dados.pacientes.slice(0, 5).map((p) => (
                <li key={p.id} className="shrink-0">
                  <Link
                    href={`/pacientes/${p.id}`}
                    className="linha flex h-16 items-center gap-3 pr-4 pl-2.5 text-tinta no-underline"
                  >
                    <Avatar nome={p.nome} chave={p.id} tamanho={44} />
                    <span className="flex flex-col">
                      <span className="text-[14.5px] font-semibold">
                        {primeiroNome(p.nome)}
                      </span>
                      <span className="text-[12.5px] text-nevoa">
                        {p.ultima === null ? "sem consulta" : haQuanto(p.ultima, agora)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="sticky bottom-5 mt-auto hidden justify-center pt-10 lg:flex">
        <BarraViva />
      </div>
    </div>
  );
}
