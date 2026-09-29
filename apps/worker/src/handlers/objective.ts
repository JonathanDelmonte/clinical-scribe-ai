/**
 * Handler do objetivo da sessão — receita, encaminhamento, pedido de exames,
 * resumo para o paciente.
 *
 * Roda o mesmo caminho da nota: prompt com identificadores citáveis, resposta
 * estruturada, conferência determinística. O que muda é a regra que o prompt
 * carrega — ver `objective.ts` em @scribe/core para por que ela é mais dura.
 */

import {
  buildObjectivePrompt,
  countGaps,
  FORMATO_DO_OBJETIVO,
  objetivoPorSlug,
  parseObjectiveResponse,
  PROMPT_VERSION_OBJETIVO,
  validateObjective,
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

import type { EscolherLlm } from "../llm/index.js";
import { ErroDefinitivo, type ClaimedJob } from "../queue.js";

export function makeObjectiveHandler(
  db: Database,
  escolherLlm: EscolherLlm,
  logger: Logger,
) {
  return async function handleGenerateObjective(job: ClaimedJob): Promise<void> {
    const { sessionId } = job;
    if (sessionId === null) throw new Error("job de objetivo sem sessionId");

    const slug =
      typeof job.payload === "object" && job.payload !== null && "slug" in job.payload
        ? String((job.payload as { slug: unknown }).slug)
        : "";

    const objetivo = objetivoPorSlug(slug);
    if (objetivo === null) {
      throw new Error(`objetivo desconhecido: "${slug}"`);
    }

    const log = logger.child({ sessionId, jobId: job.id, objetivo: slug });

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (session === undefined) throw new Error(`sessão ${sessionId} não encontrada`);

    // O mesmo modelo que a nota usaria — ver `escolha.ts`. Sem modelo
    // utilizável, o motivo fica no job, e a tela o mostra.
    const escolha = await escolherLlm(session.professionalId);
    if (!escolha.ok) throw new ErroDefinitivo(escolha.motivo);
    const llm = escolha.provider;

    const linhas = await db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.sessionId, sessionId))
      .orderBy(asc(transcriptSegments.startMs));

    if (linhas.length === 0) {
      throw new Error("Consulta sem transcrição: não há de onde gerar o documento.");
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

    // Uma receita é feita do que o PROFISSIONAL prescreveu. Sem saber quem ele
    // é, o modelo poderia transformar "eu tomo dipirona" — fala do paciente —
    // numa prescrição nova.
    if (!segments.some((s) => s.role === "professional")) {
      throw new Error(
        "Nenhum trecho identificado como profissional. Confirme os papéis antes " +
          "de gerar este documento.",
      );
    }

    // O formato DO OBJETIVO, e não o da nota: com o da nota imposto pelo
    // fornecedor, o documento saía sempre vazio.
    const resposta = await llm.complete(
      buildObjectivePrompt(segments, objetivo),
      FORMATO_DO_OBJETIVO,
    );
    const parsed = parseObjectiveResponse(resposta.text);
    const validacao = validateObjective(parsed, segments);
    const lacunas = countGaps(parsed);

    log.info(
      {
        itens: parsed.items.length,
        comLacuna: lacunas,
        bloqueantes: validacao.blocking.length,
        tokensIn: resposta.usage.inputTokens,
        tokensOut: resposta.usage.outputTokens,
      },
      parsed.items.length === 0
        ? "documento vazio — a consulta não sustentou nenhum item"
        : "documento gerado",
    );

    await db.insert(documents).values({
      sessionId,
      professionalId: session.professionalId,
      type: objetivo.documentType,
      content: {
        objectiveSlug: slug,
        title: parsed.title === "" ? objetivo.name : parsed.title,
        items: parsed.items,
        provider: llm.name,
        dataPolicy: llm.dataPolicy,
      },
      model: resposta.model,
      promptVersion: PROMPT_VERSION_OBJETIVO,
      citationIssues: validacao.issues,
    });

    await db.insert(usageEvents).values({
      professionalId: session.professionalId,
      sessionId,
      kind: "llm_note",
      tokensIn: resposta.usage.inputTokens,
      tokensOut: resposta.usage.outputTokens,
      costCents: 0,
      provider: `${llm.name}:${resposta.model}`,
    });
  };
}
