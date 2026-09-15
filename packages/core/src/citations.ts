/**
 * Ancoragem de afirmações no áudio — o mecanismo anti-alucinação.
 *
 * Duas metades que se encaixam:
 *
 *   1. `formatSegmentsForPrompt` entrega ao LLM os trechos com IDs opacos.
 *   2. `validateCitations` confere, SEM IA no meio, que todo ID citado existe.
 *
 * O ponto da técnica: um modelo não consegue inventar um ID opaco que passe na
 * validação. Ele pode inventar um timestamp — `00:04:17` parece tão real quanto
 * qualquer outro — mas não consegue adivinhar `seg_b8e2f1`. Trocamos um erro
 * silencioso e plausível por um erro ruidoso e detectável.
 *
 * Esta é a primeira camada de defesa do Marco 4. As outras (verificação de
 * suporte por LLM barato, revisão obrigatória) vêm depois e não substituem
 * esta: só esta é determinística.
 */

import type { CitedStatement, TranscriptSegment } from "./domain.js";

export type CitationIssue =
  /** Afirmação clínica sem nenhuma fonte — sempre um problema. */
  | { readonly kind: "missing_sources"; readonly path: string }
  /** O modelo citou um ID que não existe. Sinal claro de fabricação. */
  | {
      readonly kind: "unknown_segment";
      readonly path: string;
      readonly segmentId: string;
    }
  /** O mesmo trecho citado duas vezes — inofensivo, mas indica prompt confuso. */
  | {
      readonly kind: "duplicate_source";
      readonly path: string;
      readonly segmentId: string;
    };

/** Um `CitationIssue` que impede a nota de ser mostrada ao profissional. */
export function isBlocking(issue: CitationIssue): boolean {
  return issue.kind !== "duplicate_source";
}

/**
 * Confere as citações contra os trechos reais da transcrição.
 *
 * Determinístico e barato: roda em toda geração, sem chamar modelo nenhum.
 */
export function validateCitations(
  statements: readonly CitedStatement[],
  segments: readonly TranscriptSegment[],
): CitationIssue[] {
  const known = new Set(segments.map((s) => s.id));
  const issues: CitationIssue[] = [];

  for (const statement of statements) {
    if (statement.sources.length === 0) {
      issues.push({ kind: "missing_sources", path: statement.path });
      continue;
    }

    const seen = new Set<string>();
    for (const segmentId of statement.sources) {
      if (!known.has(segmentId)) {
        issues.push({
          kind: "unknown_segment",
          path: statement.path,
          segmentId,
        });
      } else if (seen.has(segmentId)) {
        issues.push({
          kind: "duplicate_source",
          path: statement.path,
          segmentId,
        });
      }
      seen.add(segmentId);
    }
  }

  return issues;
}

/**
 * Resolve as fontes de uma afirmação para os trechos e o intervalo de áudio.
 *
 * É o que a interface de revisão usa: clicar numa frase destaca os trechos e
 * toca exatamente aquele pedaço da gravação.
 *
 * Retorna `null` se nenhuma fonte existir — chame `validateCitations` antes.
 */
export function resolveCitations(
  statement: CitedStatement,
  segments: readonly TranscriptSegment[],
): { segments: TranscriptSegment[]; startMs: number; endMs: number } | null {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const resolved = statement.sources
    .map((id) => byId.get(id))
    .filter((s): s is TranscriptSegment => s !== undefined)
    .sort((a, b) => a.startMs - b.startMs);

  const first = resolved[0];
  if (first === undefined) return null;

  return {
    segments: resolved,
    startMs: first.startMs,
    endMs: Math.max(...resolved.map((s) => s.endMs)),
  };
}

const ROLE_LABELS: Record<string, string> = {
  professional: "PROFISSIONAL",
  patient: "PACIENTE",
  other: "OUTRO",
  unknown: "INDEFINIDO",
};

/** Formata milissegundos como `mm:ss` para leitura humana. */
export function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Renderiza os trechos para dentro do prompt.
 *
 * O timestamp aparece para dar contexto temporal ao modelo, mas o contrato de
 * citação é sempre pelo ID entre colchetes — é o que `validateCitations` confere.
 */
export function formatSegmentsForPrompt(
  segments: readonly TranscriptSegment[],
): string {
  return segments
    .map((s) => {
      const role = ROLE_LABELS[s.role] ?? "INDEFINIDO";
      return `[${s.id}] ${role} (${formatTimestamp(s.startMs)}): ${s.text}`;
    })
    .join("\n");
}
