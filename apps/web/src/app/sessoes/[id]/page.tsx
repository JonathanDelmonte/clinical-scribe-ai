import { patients, sessions } from "@scribe/db";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SessionView } from "@/components/SessionView";
import { asCurrentProfessional } from "@/lib/auth";

export const dynamic = "force-dynamic";

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

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <nav className="mb-6 text-sm text-muted">
        <Link
          href={`/pacientes/${header.session.patientId}`}
          className="hover:text-ink"
        >
          ← {header.patient?.name ?? "paciente"}
        </Link>
      </nav>

      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        Sessão de {header.session.createdAt.toLocaleString("pt-BR")}
      </h1>

      <SessionView sessionId={header.session.id} />
    </main>
  );
}
