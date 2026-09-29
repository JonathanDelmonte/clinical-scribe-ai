import { patients, sessions } from "@scribe/db";
import { count, desc, eq, isNull, max, sql } from "drizzle-orm";
import { Suspense } from "react";

import { DivisaoDePacientes, ListaDePacientes } from "@/components/ListaDePacientes";
import { NewPatientForm } from "@/components/NewPatientForm";
import { asCurrentUser } from "@/lib/auth";

/**
 * Pacientes: a lista fica montada enquanto as pastas trocam ao lado.
 *
 * Num layout, e não em cada página, para que abrir outra pasta não refaça a
 * lista — nem perca o que foi digitado na busca. A lista traz consultas,
 * última visita e o que falta revisar num único `left join` agregado; uma
 * consulta por paciente seria o N+1 clássico.
 */
export default async function LayoutDePacientes({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const linhas =
    (await asCurrentUser((tx) =>
      tx
        .select({
          id: patients.id,
          nome: patients.name,
          consultas: count(sessions.id),
          ultima: max(sessions.createdAt),
          paraRevisar:
            sql<number>`count(${sessions.id}) filter (where ${sessions.status} = 'ready_for_review')`.mapWith(
              Number,
            ),
        })
        .from(patients)
        .leftJoin(sessions, eq(sessions.patientId, patients.id))
        .where(isNull(patients.deletedAt))
        .groupBy(patients.id)
        // Quem foi atendido por último primeiro, e quem nunca foi logo atrás
        // pela data de cadastro. Ordenar só por cadastro empurraria para o
        // fim da lista exatamente o paciente que acabou de sair da sala.
        .orderBy(
          sql`max(${sessions.createdAt}) desc nulls last`,
          desc(patients.createdAt),
        ),
    ).catch(() => null)) ?? [];

  return (
    <DivisaoDePacientes
      cabecalho={
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-baseline gap-4">
            <h1 className="titulo-pagina">Pacientes</h1>
            <span className="text-[15px] text-nevoa">
              {linhas.length} {linhas.length === 1 ? "pessoa" : "pessoas"}
            </span>
          </div>
          <Suspense>
            <NewPatientForm />
          </Suspense>
        </header>
      }
      lista={
        <Suspense>
          <ListaDePacientes
            agora={new Date().toISOString()}
            pacientes={linhas.map((l) => ({
              id: l.id,
              nome: l.nome,
              consultas: l.consultas,
              ultima: l.ultima === null ? null : new Date(l.ultima).toISOString(),
              paraRevisar: l.paraRevisar,
            }))}
          />
        </Suspense>
      }
    >
      {children}
    </DivisaoDePacientes>
  );
}
