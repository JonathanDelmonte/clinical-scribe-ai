/**
 * Objetivo da sessão — a segunda geração, com regras mais duras que a nota.
 *
 * A §5.3 da documentação chama isto de biblioteca de objetivos: além da nota,
 * o profissional pede "gere a receita", "faça o encaminhamento", "escreva o
 * resumo para o paciente". É o diferencial que o concorrente genérico não tem.
 *
 * ## Por que as regras aqui são mais duras que as da nota
 *
 * A nota EXTRAI o que foi dito. Uma receita CRIA um ato clínico — e essa
 * diferença muda a natureza do risco.
 *
 * Quando o profissional diz "vou passar um relaxante muscular", a receita
 * precisa de nome, dose, via, frequência e duração. Quatro dos cinco não estão
 * no áudio. Um modelo prestativo preenche com o que costuma ser prescrito, e o
 * resultado é uma prescrição que ninguém prescreveu, assinada por quem confiou
 * na revisão.
 *
 * A saída é inverter a falha: o modelo **não completa**, e é obrigado a
 * **declarar o que faltou**. Uma lacuna declarada vira item de conferência; uma
 * lacuna preenchida vira erro invisível. É a mesma lógica de "seção omitida é
 * melhor que seção inventada", aplicada onde o preço do erro é maior.
 */

import { formatSegmentsForPrompt, validateCitations } from "./citations";
import type { CitedStatement, DocumentType, TranscriptSegment } from "./domain";
import type { NoteValidation } from "./note";

export const PROMPT_VERSION_OBJETIVO = "objetivo-v1";

export interface ObjectiveSpec {
  readonly name: string;
  /** Instrução específica deste objetivo, vinda do template. */
  readonly prompt: string;
  readonly documentType: DocumentType;
}

/**
 * A biblioteca inicial.
 *
 * Global (sem dono) porque estes quatro servem a qualquer especialidade. O
 * profissional cria os dele por cima — a tabela `objective_templates` aceita
 * `professional_id` nulo justamente para isso.
 */
export const OBJETIVOS_GLOBAIS: readonly (ObjectiveSpec & { slug: string })[] = [
  {
    slug: "receita",
    name: "Receita",
    documentType: "prescription",
    prompt:
      "Liste os medicamentos que o profissional prescreveu EM VOZ ALTA nesta " +
      "consulta. Para cada um, registre exatamente o que foi dito — nome, " +
      "dose, via, frequência e duração — e declare como lacuna cada um desses " +
      "itens que NÃO foi dito. Não inclua medicamento que o paciente já usava " +
      "e que não foi represcrito.",
  },
  {
    slug: "encaminhamento",
    name: "Encaminhamento",
    documentType: "referral",
    prompt:
      "Redija o encaminhamento que o profissional indicou. Inclua a " +
      "especialidade de destino, o motivo clínico e os achados relevantes — " +
      "todos apenas se ditos. Se a especialidade não foi nomeada, declare como " +
      "lacuna em vez de deduzir.",
  },
  {
    slug: "exames",
    name: "Pedido de exames",
    documentType: "custom_objective",
    prompt:
      "Liste os exames solicitados pelo profissional, um por item, com a " +
      "justificativa clínica quando ela tiver sido dita.",
  },
  {
    slug: "resumo-paciente",
    name: "Resumo para o paciente",
    documentType: "patient_summary",
    prompt:
      "Escreva um resumo em linguagem simples, dirigido ao paciente, do que " +
      "foi conversado e do que ele precisa fazer. Sem jargão, sem sigla não " +
      "explicada, frases curtas. Não acrescente orientação que não foi dada.",
  },
];

export function objetivoPorSlug(slug: string): ObjectiveSpec | null {
  return OBJETIVOS_GLOBAIS.find((o) => o.slug === slug) ?? null;
}

/**
 * Monta as instruções para o objetivo.
 *
 * Compartilha com a nota a mecânica central — citar identificadores opacos de
 * uma lista fechada — porque é ela que torna a fabricação detectável. O que
 * muda é a regra 2, que aqui vale mais que todas as outras juntas.
 */
export function buildObjectivePrompt(
  segments: readonly TranscriptSegment[],
  objective: ObjectiveSpec,
): string {
  return `Você está produzindo um documento a partir de uma consulta clínica.

DOCUMENTO PEDIDO: ${objective.name}
${objective.prompt}

TRECHOS DA CONSULTA
Cada linha começa com um identificador entre colchetes. Use esses
identificadores — e somente esses — para citar suas fontes.

${formatSegmentsForPrompt(segments)}

REGRAS — todas obrigatórias

1. FONTE PARA TUDO. Todo item precisa de pelo menos um identificador em
   "fontes". Identificador fora da lista acima é rejeitado automaticamente.

2. NUNCA COMPLETE O QUE NÃO FOI DITO. Esta é a regra que mais importa aqui.
   Se o profissional disse o medicamento mas não a dose, escreva o medicamento
   sem dose e registre "dose" em "lacunas". Se disse "vou encaminhar" sem dizer
   para qual especialidade, registre a especialidade como lacuna.
   Preencher com o que "normalmente" se prescreve é criar uma prescrição que
   ninguém fez. Uma lacuna declarada é o comportamento correto.

3. NADA DE NOVO. Não acrescente medicamento, exame, orientação ou
   encaminhamento que o profissional não tenha enunciado.

4. SE NADA FOI DITO, devolva a lista de itens vazia. Documento vazio é a
   resposta certa quando a consulta não sustenta nenhum.

FORMATO DA RESPOSTA
JSON puro, sem texto em volta, sem blocos de código:

{
  "titulo": "<título curto do documento>",
  "itens": [
    {
      "texto": "<o item, exatamente como sustentado pelo áudio>",
      "fontes": ["<id>", "<id>"],
      "lacunas": ["<o que faltou ser dito, ex: dose, frequência>"]
    }
  ]
}`;
}

export interface ObjectiveItem extends CitedStatement {
  /** O que o profissional precisa completar. Vazio = nada falta. */
  readonly gaps: readonly string[];
}

export interface ParsedObjective {
  readonly title: string;
  readonly items: readonly ObjectiveItem[];
}

/** Lê a resposta do modelo, sem confiar nela. Ver `parseNoteResponse`. */
export function parseObjectiveResponse(raw: string): ParsedObjective {
  const limpo = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let dados: unknown;
  try {
    dados = JSON.parse(limpo);
  } catch {
    return { title: "", items: [] };
  }
  if (typeof dados !== "object" || dados === null) return { title: "", items: [] };

  const { titulo, itens } = dados as { titulo?: unknown; itens?: unknown };
  const title = typeof titulo === "string" ? titulo.trim() : "";
  if (!Array.isArray(itens)) return { title, items: [] };

  const items: ObjectiveItem[] = [];
  itens.forEach((bruto, i) => {
    if (typeof bruto !== "object" || bruto === null) return;
    const { texto, fontes, lacunas } = bruto as Record<string, unknown>;
    if (typeof texto !== "string" || texto.trim() === "") return;

    items.push({
      path: `item[${i}]`,
      text: texto.trim(),
      // Mantém item sem fonte para a validação REPORTAR a falta. Descartar
      // aqui esconderia o problema — ver a mesma decisão em `note.ts`.
      sources: Array.isArray(fontes)
        ? fontes.filter((f): f is string => typeof f === "string")
        : [],
      gaps: Array.isArray(lacunas)
        ? lacunas.filter((l): l is string => typeof l === "string" && l.trim() !== "")
        : [],
    });
  });

  return { title, items };
}

export function validateObjective(
  parsed: ParsedObjective,
  segments: readonly TranscriptSegment[],
): NoteValidation {
  const issues = validateCitations(parsed.items, segments);
  const blocking = issues.filter((i) => i.kind !== "duplicate_source");
  return { issues, blocking, acceptable: blocking.length === 0 };
}

/**
 * Quantos itens estão incompletos.
 *
 * É o número que a tela mostra em destaque. Uma receita com três lacunas não é
 * uma receita ruim — é uma receita que precisa de três decisões do
 * profissional antes de existir, e dizer isso na cara evita que ela seja
 * assinada como se estivesse pronta.
 */
export function countGaps(parsed: ParsedObjective): number {
  return parsed.items.filter((i) => i.gaps.length > 0).length;
}
