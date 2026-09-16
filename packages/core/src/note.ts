/**
 * Nota clínica ancorada no áudio — Marco 4.
 *
 * O coração do produto, e o lugar onde ele pode causar dano. A §11 da
 * documentação traz o número que governa este arquivo: num levantamento de
 * 2026, **62% dos achados de exame físico fabricados passaram despercebidos**
 * na revisão do profissional — porque soavam críveis.
 *
 * Prompt pedindo "não invente" não resolve isso. O que resolve é estrutura:
 *
 *   1. O modelo só pode CITAR identificadores de uma lista fechada
 *   2. Toda citação é conferida sem IA no meio
 *   3. Seção sem base é OMITIDA, nunca preenchida
 *   4. A nota nasce rascunho e só vira documento com clique humano
 *
 * A camada 1 é a que faz o resto funcionar. Ver `citations.ts`.
 */

import { validateCitations, type CitationIssue } from "./citations";
import type { CitedStatement, TranscriptSegment } from "./domain";
import { formatSegmentsForPrompt } from "./citations";

/**
 * As seções da nota, na ordem da anamnese.
 *
 * `obrigatoria` marca o que uma consulta sempre tem. As demais são omitidas
 * quando o áudio não as sustenta — e omitir é o comportamento correto: uma
 * seção de exame físico preenchida numa consulta onde ninguém examinou nada é
 * exatamente a fabricação que mais passa despercebida.
 */
export const SECOES = [
  {
    chave: "queixaPrincipal",
    titulo: "Queixa principal",
    descricao: "o motivo da consulta, nas palavras do paciente",
    obrigatoria: true,
  },
  {
    chave: "historiaDoencaAtual",
    titulo: "História da doença atual",
    descricao: "início, evolução, fatores de melhora e piora, sintomas associados",
    obrigatoria: true,
  },
  {
    chave: "antecedentes",
    titulo: "Antecedentes",
    descricao: "doenças prévias, cirurgias, alergias, história familiar",
    obrigatoria: false,
  },
  {
    chave: "medicamentosEmUso",
    titulo: "Medicamentos em uso",
    descricao: "o que o paciente já toma, com dose quando mencionada",
    obrigatoria: false,
  },
  {
    chave: "exameFisico",
    titulo: "Exame físico",
    descricao: "apenas achados verbalizados durante a consulta",
    obrigatoria: false,
  },
  {
    chave: "hipoteseDiagnostica",
    titulo: "Hipótese diagnóstica",
    descricao: "apenas se o profissional a enunciou",
    obrigatoria: false,
  },
  {
    chave: "conduta",
    titulo: "Conduta",
    descricao: "prescrições, exames solicitados, orientações, retorno",
    obrigatoria: false,
  },
] as const;

export type SecaoChave = (typeof SECOES)[number]["chave"];

export interface NoteSection {
  readonly key: SecaoChave;
  readonly statements: readonly CitedStatement[];
}

export interface ClinicalNote {
  readonly sections: readonly NoteSection[];
  readonly model: string;
  readonly promptVersion: string;
}

/** Versão do prompt, gravada em cada nota. */
export const PROMPT_VERSION = "nota-v1";

/**
 * Monta as instruções para o modelo.
 *
 * Separado da chamada de propósito: é a peça que mais vai mudar, e poder
 * comparar duas versões do prompt sobre a mesma transcrição — sem rede, sem
 * custo, num teste — é o que torna possível melhorar a qualidade em vez de
 * chutar.
 */
export function buildNotePrompt(
  segments: readonly TranscriptSegment[],
  objective: string | null,
): string {
  const secoes = SECOES.map(
    (s) =>
      `  - "${s.chave}" (${s.titulo}): ${s.descricao}` +
      (s.obrigatoria ? "" : " — OMITA se o áudio não sustentar"),
  ).join("\n");

  return `Você está transcrevendo uma consulta clínica em nota estruturada.

TRECHOS DA CONSULTA
Cada linha começa com um identificador entre colchetes. Use esses
identificadores — e somente esses — para citar suas fontes.

${formatSegmentsForPrompt(segments)}

REGRAS — todas obrigatórias

1. FONTE PARA TUDO. Toda afirmação clínica precisa de pelo menos um
   identificador em "fontes". Identificador que não esteja na lista acima é
   rejeitado automaticamente.

2. NÃO INVENTE. Registre apenas o que foi dito. Se algo não foi mencionado,
   a seção inteira sai do resultado. Seção ausente é correta; seção preenchida
   com o que "normalmente" apareceria é erro grave.

3. EXAME FÍSICO só entra se o profissional verbalizou o achado. Não deduza
   exame a partir de conduta, nem presuma o que costuma ser examinado.

4. MEDICAMENTO E DOSE apenas se ditos explicitamente. Nunca complete a dose,
   a via ou a frequência que "faria sentido". Se só o nome foi dito, registre
   só o nome.

5. SEM DIAGNÓSTICO NOVO. Hipótese diagnóstica só entra se o profissional a
   enunciou em voz alta.

6. PALAVRAS DO PACIENTE na queixa principal, sem traduzir para jargão.

7. INCERTEZA PRESERVADA. Se o paciente disse "acho que faz uns três dias",
   registre a dúvida — não converta em "há três dias".

${objective !== null ? `OBJETIVO DESTA SESSÃO\nO profissional pediu: "${objective}"\nAtenda a isso além da nota, seguindo as mesmas regras.\n` : ""}
FORMATO DA RESPOSTA
JSON puro, sem texto em volta, sem blocos de código:

{
  "secoes": [
    {
      "chave": "<uma das chaves abaixo>",
      "afirmacoes": [
        { "texto": "<a afirmação clínica>", "fontes": ["<id>", "<id>"] }
      ]
    }
  ]
}

Chaves permitidas:
${secoes}

Inclua apenas as seções que o áudio sustenta.`;
}

export interface ParsedNote {
  readonly statements: readonly CitedStatement[];
  readonly sections: readonly NoteSection[];
}

/**
 * Lê a resposta do modelo, sem confiar nela.
 *
 * Tudo aqui é defensivo: chave desconhecida some, afirmação sem texto some,
 * fonte que não é string some. A alternativa — confiar no formato e quebrar em
 * produção — transformaria um erro de formatação numa consulta perdida.
 */
export function parseNoteResponse(raw: string): ParsedNote {
  // Modelos frequentemente embrulham JSON em blocos de código apesar da
  // instrução. Remover a cerca é mais barato que rejeitar e repetir a chamada.
  const limpo = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let dados: unknown;
  try {
    dados = JSON.parse(limpo);
  } catch {
    return { statements: [], sections: [] };
  }

  const chavesValidas = new Set<string>(SECOES.map((s) => s.chave));
  const secoesBrutas =
    typeof dados === "object" && dados !== null && "secoes" in dados
      ? (dados as { secoes: unknown }).secoes
      : null;
  if (!Array.isArray(secoesBrutas)) return { statements: [], sections: [] };

  const sections: NoteSection[] = [];
  const statements: CitedStatement[] = [];

  for (const bruta of secoesBrutas) {
    if (typeof bruta !== "object" || bruta === null) continue;
    const { chave, afirmacoes } = bruta as {
      chave?: unknown;
      afirmacoes?: unknown;
    };
    if (typeof chave !== "string" || !chavesValidas.has(chave)) continue;
    if (!Array.isArray(afirmacoes)) continue;

    const daSecao: CitedStatement[] = [];
    afirmacoes.forEach((a, i) => {
      if (typeof a !== "object" || a === null) return;
      const { texto, fontes } = a as { texto?: unknown; fontes?: unknown };
      if (typeof texto !== "string" || texto.trim() === "") return;
      const sources = Array.isArray(fontes)
        ? fontes.filter((f): f is string => typeof f === "string")
        : [];
      const statement: CitedStatement = {
        path: `${chave}[${i}]`,
        text: texto.trim(),
        sources,
      };
      daSecao.push(statement);
      statements.push(statement);
    });

    if (daSecao.length > 0) {
      sections.push({ key: chave as SecaoChave, statements: daSecao });
    }
  }

  return { statements, sections };
}

export interface NoteValidation {
  readonly issues: readonly CitationIssue[];
  readonly blocking: readonly CitationIssue[];
  readonly acceptable: boolean;
}

/**
 * Confere a nota contra os trechos reais.
 *
 * Determinístico e barato: roda em toda geração, sem chamar modelo nenhum.
 * É a única camada que não pode falhar em silêncio.
 */
export function validateNote(
  parsed: ParsedNote,
  segments: readonly TranscriptSegment[],
): NoteValidation {
  const issues = validateCitations(parsed.statements, segments);
  const blocking = issues.filter((i) => i.kind !== "duplicate_source");
  return { issues, blocking, acceptable: blocking.length === 0 };
}

export function sectionTitle(key: SecaoChave): string {
  return SECOES.find((s) => s.chave === key)?.titulo ?? key;
}

/**
 * Esquema da resposta, para fornecedores que sabem impor formato.
 *
 * Gemini e outros aceitam um esquema (subconjunto do OpenAPI 3.0) e passam a
 * **garantir** a forma da saída — some a classe inteira de falha "o modelo
 * respondeu em prosa" ou "embrulhou em bloco de código".
 *
 * Isso NÃO substitui `validateNote`, e a distinção é o ponto central deste
 * arquivo: o esquema garante que `fontes` é uma lista de textos. Ele não tem
 * como garantir que esses textos são identificadores que existem. Um modelo
 * pode devolver `["seg_zzz"]` — perfeitamente válido para o esquema, e uma
 * fabricação. Quem pega isso é a conferência determinística, sem IA no meio.
 *
 * Forma imposta pelo esquema · conteúdo conferido por nós. As duas camadas.
 */
export const NOTE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    secoes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chave: { type: "string", enum: SECOES.map((s) => s.chave) },
          afirmacoes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                texto: { type: "string" },
                fontes: { type: "array", items: { type: "string" } },
              },
              required: ["texto", "fontes"],
            },
          },
        },
        required: ["chave", "afirmacoes"],
      },
    },
  },
  required: ["secoes"],
} as const;

/**
 * Uma afirmação depois de passar pelas mãos do profissional.
 *
 * `confirmedAt` é o campo que carrega a decisão clínica, e ele existe por uma
 * razão específica.
 *
 * A conferência determinística responde "a máquina inventou isto?". Ela NÃO
 * responde "isto é verdade?" — e há casos legítimos em que uma afirmação está
 * certa e sem âncora válida: o profissional reescreveu a frase, ou juntou duas
 * em uma, ou sabe de algo que o microfone não pegou.
 *
 * Travar a aprovação nesses casos empurraria a pessoa a apagar informação
 * correta para conseguir assinar — o pior resultado possível. Então a saída é
 * TRANSFERIR a responsabilidade explicitamente: sem citação válida, vale a
 * palavra de quem assina, e fica registrado que foi assim. É o que a lei já
 * supõe de um prontuário, escrito no dado.
 */
export interface ReviewedStatement extends CitedStatement {
  /** Quando o profissional alterou o texto gerado. */
  readonly editedAt?: string;
  /** Quando o profissional assumiu uma afirmação sem âncora válida. */
  readonly confirmedAt?: string;
}

export interface ApprovalCheck {
  readonly ok: boolean;
  /** Caminhos das afirmações que ainda impedem a aprovação. */
  readonly pending: readonly string[];
}

/**
 * A nota pode virar documento?
 *
 * Só bloqueia o que é insustentável: afirmação sem fonte alguma, ou citando
 * trecho que não existe — e que ninguém assumiu. Fonte repetida não bloqueia,
 * como em `validateNote`.
 *
 * Determinístico, sem IA, testável sem banco. A aprovação é o momento em que
 * um rascunho vira registro clínico, e essa fronteira não pode depender de
 * julgamento de modelo.
 */
export function checkApproval(
  statements: readonly ReviewedStatement[],
  segments: readonly TranscriptSegment[],
): ApprovalCheck {
  const issues = validateCitations(statements, segments);
  const problematicos = new Set(
    issues.filter((i) => i.kind !== "duplicate_source").map((i) => i.path),
  );

  const assumidos = new Set(
    statements.filter((s) => s.confirmedAt !== undefined).map((s) => s.path),
  );

  const pending = [...problematicos].filter((p) => !assumidos.has(p)).sort();
  return { ok: pending.length === 0, pending };
}

/** Todas as afirmações de uma nota, achatadas. */
export function allStatements(
  sections: readonly { statements: readonly ReviewedStatement[] }[],
): ReviewedStatement[] {
  return sections.flatMap((s) => [...s.statements]);
}
