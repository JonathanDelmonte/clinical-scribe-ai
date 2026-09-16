/**
 * Handler da nota clínica — Marco 4.
 *
 *   trechos do banco → prompt com IDs citáveis → modelo → conferência
 *   determinística → documento em rascunho
 *
 * O passo que define o produto é o penúltimo. O modelo devolve afirmações com
 * `fontes`, e cada fonte é conferida contra a lista real de trechos **sem IA
 * no meio**. Uma fonte inventada não passa. Uma afirmação sem fonte não passa.
 *
 * Isso é possível porque o prompt só oferece identificadores opacos: o modelo
 * não tem como adivinhar `seg_3f9a1c`. Se pedíssemos timestamps, ele geraria
 * números plausíveis e a fabricação seria indistinguível de um acerto.
 */

import {
  buildNotePrompt,
  parseNoteResponse,
  PROMPT_VERSION,
  validateNote,
  type LlmProvider,
  type TranscriptSegment,
} from "@scribe/core";
import {
  documents,
  sessions,
  transcriptSegments,
  usageEvents,
  type Database,
} from "@scribe/db";
import { asc, eq } from "drizzle-orm";
import type { Logger } from "pino";

import type { ClaimedJob } from "../queue.js";

export function makeNoteHandler(db: Database, llm: LlmProvider, logger: Logger) {
  return async function handleGenerateNote(job: ClaimedJob): Promise<void> {
    const { sessionId } = job;
    if (sessionId === null) throw new Error("job de nota sem sessionId");

    const log = logger.child({ sessionId, jobId: job.id, model: llm.model });

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (session === undefined) throw new Error(`sessão ${sessionId} não encontrada`);

    const linhas = await db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.sessionId, sessionId))
      .orderBy(asc(transcriptSegments.startMs));

    if (linhas.length === 0) {
      throw new Error("sessão sem transcrição — nada de onde gerar a nota");
    }

    const segments: TranscriptSegment[] = linhas.map((l) => ({
      id: l.id,
      speakerLabel: l.speakerLabel,
      role: l.role,
      roleSource: l.roleSource,
      startMs: l.startMs,
      endMs: l.endMs,
      text: l.text,
      confidence: l.confidence,
    }));

    // Sem saber quem é o profissional, "o paciente relatou" e "o profissional
    // orientou" viram a mesma coisa — e trocar os dois numa nota clínica
    // inverte o sentido do registro inteiro. Melhor não gerar.
    if (!segments.some((s) => s.role === "professional")) {
      throw new Error(
        "Nenhum trecho identificado como profissional. Confirme os papéis na " +
          "tela da sessão antes de gerar a nota.",
      );
    }

    await db
      .update(sessions)
      .set({ status: "generating" })
      .where(eq(sessions.id, sessionId));

    try {
      const prompt = buildNotePrompt(segments, session.objectiveText);
      const inicio = Date.now();
      const resposta = await llm.complete(prompt);

      const parsed = parseNoteResponse(resposta.text);
      const validacao = validateNote(parsed, segments);

      log.info(
        {
          secoes: parsed.sections.length,
          afirmacoes: parsed.statements.length,
          problemas: validacao.issues.length,
          bloqueantes: validacao.blocking.length,
          tokensIn: resposta.usage.inputTokens,
          tokensOut: resposta.usage.outputTokens,
          elapsedMs: Date.now() - inicio,
        },
        validacao.acceptable ? "nota gerada" : "nota gerada com problemas de citação",
      );

      // A nota é GRAVADA mesmo com problema de citação — e isso é deliberado.
      //
      // Descartar deixaria o profissional com uma falha genérica e nada para
      // olhar. Gravada, ele vê a nota, vê exatamente quais afirmações estão
      // sem âncora, e decide. O que a nota problemática nunca faz é sair do
      // rascunho: `approvedAt` continua nulo, e a interface marca cada
      // afirmação sem fonte em vermelho.
      await db.insert(documents).values({
        sessionId,
        professionalId: session.professionalId,
        type: "clinical_note",
        content: {
          sections: parsed.sections,
          provider: llm.name,
          dataPolicy: llm.dataPolicy,
        },
        model: resposta.model,
        promptVersion: PROMPT_VERSION,
        citationIssues: validacao.issues,
      });

      await db.insert(usageEvents).values({
        professionalId: session.professionalId,
        sessionId,
        kind: "llm_note",
        tokensIn: resposta.usage.inputTokens,
        tokensOut: resposta.usage.outputTokens,
        // Zero porque o nível gratuito não cobra. Quando o modelo pago entrar,
        // é aqui que o custo real por consulta aparece — e é o número que
        // decide se o plano grátis fecha (§11 do plano).
        costCents: 0,
        provider: `${llm.name}:${resposta.model}`,
      });

      await db
        .update(sessions)
        .set({ status: "ready_for_review", failureReason: null })
        .where(eq(sessions.id, sessionId));
    } catch (erro) {
      // A transcrição continua boa. Marcar a sessão como "failed" esconderia
      // um trabalho que deu certo por causa de um que não deu — o profissional
      // perderia acesso a trechos perfeitamente revisáveis.
      const motivo = erro instanceof Error ? erro.message : String(erro);
      await db
        .update(sessions)
        .set({ status: "ready_for_review", failureReason: motivo })
        .where(eq(sessions.id, sessionId));
      throw erro;
    }
  };
}
