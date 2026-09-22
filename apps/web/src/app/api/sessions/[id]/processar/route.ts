import type { Account } from "@scribe/core";
import { jobs, sessions } from "@scribe/db";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { ACOES, auditar } from "@/lib/audit";
import { asCurrentProfessional } from "@/lib/auth";
import { verificarQuota } from "@/lib/quota";

export const dynamic = "force-dynamic";

/**
 * Põe na fila uma sessão que tem áudio e não foi processada.
 *
 * Existe por causa da quota: uma sessão barrada por falta de minutos fica com
 * o áudio guardado e `status = failed`. Sem esta rota, isso seria um beco sem
 * saída — a gravação existiria no disco e não haveria nenhum caminho na
 * interface para transformá-la em nota depois de o plano mudar ou o mês virar.
 *
 * Serve também para a falha comum de infraestrutura: o serviço de transcrição
 * estava fora do ar quando a consulta terminou.
 *
 * O que ela NÃO faz é re-gerar a nota de uma sessão já transcrita — isso é
 * outra rota, com outro custo.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const resultado = await asCurrentProfessional(async (tx, me) => {
    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    if (session === undefined) return { error: "sessão não encontrada" } as const;
    if (session.audioPath === null) {
      return { error: "esta sessão não tem áudio para processar" } as const;
    }
    if (session.audioDeletedAt !== null) {
      // Retenção mínima é o comportamento certo (LGPD Art. 6º) — mas depois
      // dela não há o que reprocessar, e dizer isso é melhor do que enfileirar
      // um job que vai falhar procurando um arquivo apagado.
      return {
        error: "o áudio desta sessão já foi apagado pela política de retenção",
      } as const;
    }

    // Já está na fila ou rodando: um segundo job transcreveria o mesmo áudio
    // duas vezes e pagaria duas vezes por ele.
    const [emAndamento] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.sessionId, session.id),
          eq(jobs.kind, "transcribe"),
          inArray(jobs.status, ["pending", "running"]),
        ),
      )
      .limit(1);

    if (emAndamento !== undefined) {
      return { error: "esta sessão já está na fila" } as const;
    }

    const account: Account = {
      role: me.role,
      plan: me.plan,
      preferredEngine: me.preferredEngine,
    };
    const quota = await verificarQuota(
      tx,
      account,
      session.durationMs === null ? null : session.durationMs / 60_000,
    );

    if (!quota.permitido) {
      return { quotaExcedida: true, motivo: quota.motivo, quota: quota.quota } as const;
    }

    await tx
      .update(sessions)
      .set({ status: "uploaded", failureReason: null })
      .where(eq(sessions.id, session.id));

    await tx.insert(jobs).values({
      professionalId: me.id,
      sessionId: session.id,
      kind: "transcribe",
    });

    await auditar(tx, {
      acao: ACOES.reprocessada,
      entidade: "sessions",
      entidadeId: session.id,
      metadados: { statusAnterior: session.status },
    });

    return { ok: true, quota: quota.quota } as const;
  });

  if (resultado === null) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  if ("error" in resultado) {
    return NextResponse.json({ error: resultado.error }, { status: 409 });
  }
  if ("quotaExcedida" in resultado) {
    return NextResponse.json(
      { error: resultado.motivo, quota: resultado.quota },
      { status: 402 },
    );
  }

  return NextResponse.json(resultado, { status: 202 });
}
