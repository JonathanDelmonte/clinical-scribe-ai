import { canChooseEngine, PLAN_DEFAULT_ENGINE, type Account } from "@scribe/core";
import { patients, sessions, transcriptSegments } from "@scribe/db";
import { desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AcoesDaSessao } from "@/components/AcoesDaSessao";
import { Avatar } from "@/components/Avatar";
import { FichaDeEstado } from "@/components/FichaDeEstado";
import { Helice } from "@/components/Helice";
import { IconeAvancar, IconeMicrofone, IconeVoltar } from "@/components/Icones";
import { PontoViva } from "@/components/Orbe";
import { PatientDetails } from "@/components/PatientDetails";
import { SessionRecorder } from "@/components/SessionRecorder";
import { asCurrentUser, exigirProfissional } from "@/lib/auth";
import { desenharHelice, type Fala } from "@/lib/helice";
import { dataParaFormulario, idadeEmAnos } from "@/lib/patients";
import { quotaDoMes } from "@/lib/quota";

export const dynamic = "force-dynamic";

/** Estados em que a consulta já tem transcrição para desenhar a hélice. */
const COM_TRANSCRICAO = new Set(["ready_for_review", "approved"]);

const MES = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
  timeZone: "America/Sao_Paulo",
});
const DIA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const HORA = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const DESDE = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

export default async function PatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const me = await exigirProfissional();

  const account: Account = {
    role: me.role,
    plan: me.plan,
    preferredEngine: me.preferredEngine,
  };

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

    // A quota vem na mesma transação: é uma consulta a mais, não uma ida a
    // mais ao banco, e é o que permite avisar ANTES de a pessoa gravar em vez
    // de depois de ela subir o áudio.
    const quota = await quotaDoMes(tx, account);

    // As falas das consultas transcritas, para a hélice de cada linha — numa
    // consulta só, e só as colunas que o desenho usa.
    const transcritas = rows
      .filter((s) => COM_TRANSCRICAO.has(s.status))
      .map((s) => s.id);
    const falas =
      transcritas.length === 0
        ? []
        : await tx
            .select({
              sessionId: transcriptSegments.sessionId,
              role: transcriptSegments.role,
              startMs: transcriptSegments.startMs,
              endMs: transcriptSegments.endMs,
            })
            .from(transcriptSegments)
            .where(inArray(transcriptSegments.sessionId, transcritas));

    return { patient, sessions: rows, quota, falas };
  }).catch(() => null);

  if (data === null || data === undefined) notFound();

  const { patient, sessions: sessionRows, quota, falas } = data;

  const falasPorSessao = new Map<string, Fala[]>();
  for (const f of falas) {
    const lista = falasPorSessao.get(f.sessionId) ?? [];
    lista.push(f);
    falasPorSessao.set(f.sessionId, lista);
  }

  const idade = patient.birthDate === null ? null : idadeEmAnos(patient.birthDate);
  const detalhes = [
    idade === null ? null : `${idade} ${idade === 1 ? "ano" : "anos"}`,
    `paciente desde ${DESDE.format(patient.createdAt)}`,
  ].filter((d) => d !== null);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/pacientes"
        className="-mb-2 inline-flex items-center gap-1 self-start text-sm font-medium text-grafite no-underline hover:text-tinta lg:hidden"
      >
        <IconeVoltar tamanho={18} />
        Pacientes
      </Link>

      <section className="vidro flex flex-col gap-6 rounded-[30px] px-6 py-7 sm:px-9">
        <div className="flex items-center gap-5">
          <Avatar
            nome={patient.name}
            chave={patient.id}
            tamanho={72}
            className="shadow-[0_14px_28px_-16px_rgb(22_52_70/0.45)]"
          />
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 className="text-[clamp(1.875rem,1.4rem+1.6vw,2.75rem)] leading-none font-normal tracking-[-0.035em]">
              {patient.name}
            </h2>
            <span className="text-[15px] text-grafite">{detalhes.join(" · ")}</span>
          </div>
        </div>

        {patient.deletedAt !== null && (
          <p className="alerta alerta-erro">
            Paciente arquivado. As consultas continuam aqui; ele não aparece mais na
            lista.
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <a href="#consulta" className="botao-principal">
            Começar consulta
            <span className="botao-icone">
              <IconeMicrofone tamanho={19} />
            </span>
          </a>
          <Link href="/viva" className="botao-vidro">
            <PontoViva tamanho={22} />
            Perguntar à Viva
          </Link>
        </div>

        <PatientDetails
          id={patient.id}
          nome={patient.name}
          nascimento={dataParaFormulario(patient.birthDate)}
          observacoes={patient.notes ?? ""}
          sessoes={sessionRows.length}
        />
      </section>

      <section
        id="consulta"
        aria-labelledby="titulo-consulta"
        className="vidro scroll-mt-6 rounded-[30px] px-6 py-7 sm:px-9"
      >
        <h2 id="titulo-consulta" className="titulo-secao mb-5">
          Nova consulta
        </h2>
        <SessionRecorder
          patientId={patient.id}
          patientName={patient.name}
          canChooseEngine={canChooseEngine(account)}
          defaultEngine={PLAN_DEFAULT_ENGINE[me.plan]}
          minutosRestantes={quota.restantes}
        />
      </section>

      <section aria-labelledby="titulo-consultas" className="flex flex-col gap-3">
        <h2 id="titulo-consultas" className="titulo-secao px-2">
          Consultas{" "}
          <span className="font-normal text-nevoa">
            ·{" "}
            {sessionRows.length === 0
              ? "nenhuma ainda"
              : `${sessionRows.length} ${sessionRows.length === 1 ? "consulta" : "consultas"}`}
          </span>
        </h2>

        {sessionRows.length === 0 ? (
          <p className="rounded-[22px] border-[1.5px] border-dashed border-tinta/15 px-6 py-6 text-[15px] leading-relaxed text-grafite">
            Quando você gravar a primeira consulta, ela fica guardada aqui, com a nota e
            os documentos.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {sessionRows.map((s) => {
              const falasDaSessao = falasPorSessao.get(s.id);
              const desenho =
                falasDaSessao === undefined
                  ? null
                  : desenharHelice(falasDaSessao, {
                      largura: 200,
                      altura: 40,
                      voltas: 6,
                      pontos: 121,
                    });
              const quando = s.startedAt ?? s.createdAt;

              return (
                <li
                  key={s.id}
                  className="vidro flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[22px] px-4 py-3 sm:flex-nowrap"
                >
                  <Link
                    href={`/sessoes/${s.id}`}
                    className="flex min-w-0 flex-1 items-center gap-4 text-tinta no-underline"
                  >
                    <span className="flex w-12 shrink-0 flex-col items-center leading-none">
                      <span className="text-[30px] font-light tracking-tight">
                        {DIA.format(quando)}
                      </span>
                      <span className="mt-1 text-[11.5px] font-semibold tracking-[0.08em] text-nevoa uppercase">
                        {MES.format(quando).replace(".", "")}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-[15px] font-semibold">
                        Consulta das {HORA.format(quando)}
                        {s.durationMs !== null && (
                          <span className="font-normal text-nevoa">
                            {" "}
                            · {Math.max(1, Math.round(s.durationMs / 60_000))} min
                          </span>
                        )}
                      </span>
                      <FichaDeEstado status={s.status} className="self-start" />
                    </span>
                    {desenho !== null && (
                      <Helice
                        desenho={desenho}
                        largura={200}
                        altura={40}
                        traco={1.6}
                        className="hidden h-7 w-24 shrink-0 md:block"
                      />
                    )}
                    <IconeAvancar tamanho={18} className="shrink-0 text-nevoa" />
                  </Link>

                  <span className="flex w-full items-center justify-end gap-4 border-t border-line pt-2 sm:w-auto sm:border-t-0 sm:pt-0">
                    {/*
                     * Exportar só aparece quando há o que exportar. Um botão que
                     * leva a uma tela vazia ensina a pessoa a não clicar nele.
                     */}
                    {(s.status === "ready_for_review" || s.status === "approved") && (
                      <Link href={`/exportar/${s.id}`} className="botao-texto">
                        exportar
                      </Link>
                    )}

                    {/*
                     * Parar e apagar aqui também, e não só na página da consulta:
                     * quem quer se livrar de um upload errado está olhando para a
                     * lista, e obrigá-lo a abrir a consulta para desfazê-la é
                     * obrigá-lo a carregar a tela que ele não quer ver.
                     */}
                    <AcoesDaSessao
                      sessionId={s.id}
                      patientId={patient.id}
                      status={s.status}
                      compacto
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
