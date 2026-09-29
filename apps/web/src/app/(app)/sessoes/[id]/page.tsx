import { patients, sessions } from "@scribe/db";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AcoesDaSessao } from "@/components/AcoesDaSessao";
import { IconeAvancar } from "@/components/Icones";
import { SessionView } from "@/components/SessionView";
import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DIA = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});
const HORA = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Carrega só o cabeçalho no servidor. O conteúdo que muda — estado e
  // transcrição — é buscado pelo cliente, que precisa consultar em intervalos
  // enquanto o worker trabalha.
  const header = await asCurrentProfessional(async (tx) => {
    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    if (session === undefined) return null;

    const [patient] = await tx
      .select()
      .from(patients)
      .where(eq(patients.id, session.patientId))
      .limit(1);

    return { session, patient: patient ?? null };
  }).catch(() => null);

  if (header === null || header === undefined) notFound();

  const quando = header.session.startedAt ?? header.session.createdAt;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <nav
          aria-label="Caminho"
          className="flex items-center gap-1.5 text-sm text-grafite"
        >
          <Link
            href="/pacientes"
            className="text-grafite no-underline hover:text-tinta"
          >
            Pacientes
          </Link>
          <IconeAvancar tamanho={14} className="text-nevoa" />
          <Link
            href={`/pacientes/${header.session.patientId}`}
            className="text-grafite no-underline hover:text-tinta"
          >
            {header.patient?.name ?? "paciente"}
          </Link>
        </nav>

        <h1 className="text-[clamp(2rem,1.5rem+1.8vw,3.25rem)] leading-none font-light tracking-[-0.04em]">
          Consulta de <span className="font-normal">{DIA.format(quando)}</span>
          <span className="ml-3 text-[0.45em] font-normal tracking-normal text-nevoa">
            às {HORA.format(quando)}
          </span>
        </h1>
      </div>

      <SessionView sessionId={header.session.id} />

      {/*
       * As saídas ficam no fim, depois do conteúdo.
       *
       * Quem abre esta página vem ver a consulta, não desfazê-la. Pôr
       * "apagar" no topo colocaria a ação irreversível no caminho do olhar de
       * quem só queria ler a nota.
       */}
      <div className="mt-4 border-t border-line pt-6">
        <AcoesDaSessao
          sessionId={header.session.id}
          patientId={header.session.patientId}
          status={header.session.status}
        />
      </div>
    </div>
  );
}
