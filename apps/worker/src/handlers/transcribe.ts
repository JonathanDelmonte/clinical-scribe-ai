/**
 * Handler de transcrição — o job que atravessa o sistema inteiro.
 *
 *   sessão no banco → decide o motor → busca o áudio → transcreve
 *   → grava os trechos → registra o uso → marca a sessão revisável
 *
 * Roda com a conexão de serviço, que ignora RLS. Isso é necessário (o worker
 * não tem usuário autenticado) e é justamente por isso que cada consulta aqui
 * filtra por `professionalId` explicitamente: sem a rede de proteção do banco,
 * a disciplina precisa estar no código.
 */

import { canProcess, resolveEngine, type Account } from "@scribe/core";
import {
  professionals,
  sessions,
  transcriptSegments,
  usageEvents,
  type Database,
} from "@scribe/db";
import type { AudioStorage } from "@scribe/storage";
import { eq } from "drizzle-orm";

import type { Logger } from "pino";
import { getAvailableProvider } from "../providers/index.js";
import type { ClaimedJob } from "../queue.js";

export function makeTranscribeHandler(
  db: Database,
  storage: AudioStorage,
  logger: Logger,
) {
  return async function handleTranscribe(job: ClaimedJob): Promise<void> {
    const { sessionId } = job;
    if (sessionId === null) {
      throw new Error("job de transcrição sem sessionId");
    }

    const log = logger.child({ sessionId, jobId: job.id });

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (session === undefined) {
      throw new Error(`sessão ${sessionId} não encontrada`);
    }
    if (session.audioPath === null) {
      throw new Error("sessão sem áudio");
    }

    const [owner] = await db
      .select()
      .from(professionals)
      .where(eq(professionals.id, session.professionalId))
      .limit(1);

    if (owner === undefined) {
      throw new Error(`profissional ${session.professionalId} não encontrado`);
    }

    const account: Account = {
      role: owner.role,
      plan: owner.plan,
      preferredEngine: owner.preferredEngine,
    };

    // ---- decisão de motor -----------------------------------------------
    const decision = resolveEngine(account, session.engineChoice);

    if (decision.ignoredChoice !== null) {
      // Ou é bug de interface oferecendo uma opção que não existe, ou é
      // alguém no plano grátis tentando usar o motor que custa dinheiro.
      // Nos dois casos, alguém precisa ver.
      log.warn(
        { requested: decision.ignoredChoice, used: decision.engine },
        "escolha de motor descartada por falta de permissão",
      );
    }

    // ---- quota, ANTES de gastar ------------------------------------------
    const sessionMinutes = (session.durationMs ?? 0) / 60_000;
    const allowance = canProcess(account, 0, sessionMinutes);
    if (!allowance.allowed) {
      await db
        .update(sessions)
        .set({ status: "failed", failureReason: allowance.reason })
        .where(eq(sessions.id, sessionId));
      log.warn({ reason: allowance.reason }, "sessão bloqueada por quota");
      return;
    }

    await db
      .update(sessions)
      .set({ status: "transcribing" })
      .where(eq(sessions.id, sessionId));

    // ---- transcrição ------------------------------------------------------
    const { provider, fellBack } = await getAvailableProvider(decision.engine);
    if (fellBack) {
      log.warn(
        { preferred: decision.engine, using: provider.engine },
        "motor preferido indisponível, usando o local",
      );
    }

    const audio = await storage.get(session.audioPath);
    const started = Date.now();

    const result = await provider.transcribe({
      audio,
      filename: session.audioPath,
      diarize: true,
    });

    log.info(
      {
        engine: provider.engine,
        model: result.model,
        segments: result.segments.length,
        speakers: result.speakers.length,
        realtimeFactor: result.realtimeFactor,
        diarization: result.diarizationApplied,
      },
      "transcrição concluída",
    );

    // ---- persistência -----------------------------------------------------
    // Reprocessar precisa ser seguro: apagar antes de inserir evita transcrição
    // duplicada quando um job é repetido depois de falhar no meio.
    await db
      .delete(transcriptSegments)
      .where(eq(transcriptSegments.sessionId, sessionId));

    if (result.segments.length > 0) {
      await db.insert(transcriptSegments).values(
        result.segments.map((s) => ({
          sessionId,
          professionalId: session.professionalId,
          speakerLabel: s.speakerLabel,
          // O papel (profissional × paciente) é atribuído no Marco 3. Até lá
          // fica "unknown" — honesto, em vez de um palpite que parece dado.
          role: "unknown" as const,
          roleSource: "llm" as const,
          startMs: s.startMs,
          endMs: s.endMs,
          text: s.text,
          confidence: s.confidence,
        })),
      );
    }

    // ---- trava de integridade ------------------------------------------
    // Os trechos ficam salvos — são reais e servem para diagnóstico. Mas a
    // sessão NÃO pode chegar ao profissional como "pronta para revisão": o
    // que falta no fim de uma consulta costuma ser a conduta, e uma nota
    // gerada sobre transcrição cortada omitiria a prescrição sem avisar
    // ninguém. Falhar alto é o único comportamento aceitável aqui.
    if (result.truncated) {
      const seconds = Math.round(result.uncoveredMs / 1000);
      const reason =
        `Transcrição incompleta: os últimos ${seconds}s do áudio não foram ` +
        `transcritos. A gravação está preservada — reprocesse antes de usar.`;

      await db
        .update(sessions)
        .set({
          status: "failed",
          failureReason: reason,
          engineUsed: provider.engine,
          durationMs: result.durationMs,
        })
        .where(eq(sessions.id, sessionId));

      log.error(
        { uncoveredMs: result.uncoveredMs, durationMs: result.durationMs },
        "transcrição truncada — sessão marcada como falha",
      );
      return;
    }

    await db.insert(usageEvents).values({
      professionalId: session.professionalId,
      sessionId,
      kind: "asr",
      minutes: result.durationMs / 60_000,
      // O motor local não tem custo por minuto: o custo dele é o servidor,
      // que é fixo. Zero aqui é o dado correto, e é o que vai fazer a
      // diferença de margem entre os planos aparecer no relatório quando o
      // motor de nuvem entrar com o preço real por minuto.
      costCents: 0,
      provider: `${provider.engine}:${result.model}`,
    });

    await db
      .update(sessions)
      .set({
        status: "ready_for_review",
        engineUsed: provider.engine,
        durationMs: result.durationMs,
        failureReason: null,
      })
      .where(eq(sessions.id, sessionId));

    log.info({ elapsedMs: Date.now() - started }, "sessão pronta para revisão");
  };
}
