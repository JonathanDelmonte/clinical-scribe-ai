import { describe, expect, it } from "vitest";

import type { TranscriptSegment } from "./domain";
import {
  allStatements,
  buildNotePrompt,
  checkApproval,
  parseNoteResponse,
  PROMPT_VERSION,
  SECOES,
  sectionTitle,
  validateNote,
} from "./note";

function trecho(id: string, text: string): TranscriptSegment {
  return {
    id,
    speakerLabel: "SPEAKER_00",
    role: "patient",
    roleSource: "llm",
    startMs: 0,
    endMs: 3000,
    text,
    confidence: 0.9,
  };
}

const TRECHOS = [
  trecho("seg_a", "Doutor, eu estou com dor nas costas faz três dias."),
  trecho("seg_b", "Tomei dipirona duas vezes."),
  trecho("seg_c", "Vou pedir um relaxante muscular."),
];

describe("buildNotePrompt", () => {
  it("expõe os identificadores que o modelo pode citar", () => {
    const p = buildNotePrompt(TRECHOS, null);
    expect(p).toContain("[seg_a]");
    expect(p).toContain("[seg_c]");
  });

  it("carrega as regras que impedem fabricação", () => {
    const p = buildNotePrompt(TRECHOS, null);
    expect(p).toContain("NÃO INVENTE");
    expect(p).toContain("EXAME FÍSICO");
    expect(p).toContain("MEDICAMENTO E DOSE");
  });

  it("inclui o objetivo da sessão quando há um", () => {
    const p = buildNotePrompt(TRECHOS, "gerar receita e plano de retorno");
    expect(p).toContain("gerar receita e plano de retorno");
  });

  it("omite a seção de objetivo quando não há", () => {
    expect(buildNotePrompt(TRECHOS, null)).not.toContain("OBJETIVO DESTA SESSÃO");
  });
});

describe("parseNoteResponse", () => {
  const RESPOSTA = JSON.stringify({
    secoes: [
      {
        chave: "queixaPrincipal",
        afirmacoes: [{ texto: "Dor nas costas há três dias", fontes: ["seg_a"] }],
      },
      {
        chave: "conduta",
        afirmacoes: [{ texto: "Relaxante muscular", fontes: ["seg_c"] }],
      },
    ],
  });

  it("lê uma resposta bem formada", () => {
    const r = parseNoteResponse(RESPOSTA);
    expect(r.sections).toHaveLength(2);
    expect(r.statements).toHaveLength(2);
    expect(r.statements[0]?.sources).toEqual(["seg_a"]);
  });

  // Modelos embrulham JSON em blocos de código apesar da instrução. Rejeitar
  // por isso desperdiçaria uma chamada inteira por um detalhe de formatação.
  it("aceita JSON dentro de bloco de código", () => {
    const r = parseNoteResponse("```json\n" + RESPOSTA + "\n```");
    expect(r.sections).toHaveLength(2);
  });

  it("devolve vazio para resposta que não é JSON", () => {
    expect(parseNoteResponse("desculpe, não consegui").sections).toEqual([]);
  });

  it("descarta seção com chave que não existe", () => {
    const r = parseNoteResponse(
      JSON.stringify({
        secoes: [
          { chave: "receitaDeBolo", afirmacoes: [{ texto: "x", fontes: ["seg_a"] }] },
          { chave: "conduta", afirmacoes: [{ texto: "ok", fontes: ["seg_c"] }] },
        ],
      }),
    );
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]?.key).toBe("conduta");
  });

  it("descarta afirmação sem texto", () => {
    const r = parseNoteResponse(
      JSON.stringify({
        secoes: [
          {
            chave: "conduta",
            afirmacoes: [{ texto: "   ", fontes: ["seg_c"] }, { fontes: ["seg_c"] }],
          },
        ],
      }),
    );
    expect(r.sections).toEqual([]);
  });

  it("mantém a afirmação sem fontes, para a validação rejeitar depois", () => {
    // Descartar aqui esconderia o problema. A afirmação precisa chegar à
    // validação para que a falta de fonte seja REPORTADA, não silenciada.
    const r = parseNoteResponse(
      JSON.stringify({
        secoes: [{ chave: "conduta", afirmacoes: [{ texto: "algo", fontes: [] }] }],
      }),
    );
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0]?.sources).toEqual([]);
  });

  it("descarta fontes que não são texto", () => {
    const r = parseNoteResponse(
      JSON.stringify({
        secoes: [
          {
            chave: "conduta",
            afirmacoes: [{ texto: "algo", fontes: ["seg_c", 42, null] }],
          },
        ],
      }),
    );
    expect(r.statements[0]?.sources).toEqual(["seg_c"]);
  });
});

describe("validateNote", () => {
  it("aceita nota cujas citações existem", () => {
    const parsed = parseNoteResponse(
      JSON.stringify({
        secoes: [{ chave: "conduta", afirmacoes: [{ texto: "x", fontes: ["seg_c"] }] }],
      }),
    );
    expect(validateNote(parsed, TRECHOS).acceptable).toBe(true);
  });

  // O caso que justifica o mecanismo inteiro: o modelo inventou uma fonte.
  // Um identificador opaco não pode ser adivinhado, então a fabricação vira
  // um erro detectável em vez de uma frase plausível na nota.
  it("bloqueia nota que cita trecho inexistente", () => {
    const parsed = parseNoteResponse(
      JSON.stringify({
        secoes: [
          {
            chave: "exameFisico",
            afirmacoes: [
              { texto: "Ausculta pulmonar sem alterações", fontes: ["seg_zzz"] },
            ],
          },
        ],
      }),
    );
    const v = validateNote(parsed, TRECHOS);
    expect(v.acceptable).toBe(false);
    expect(v.blocking[0]?.kind).toBe("unknown_segment");
  });

  it("bloqueia afirmação clínica sem fonte alguma", () => {
    const parsed = parseNoteResponse(
      JSON.stringify({
        secoes: [
          {
            chave: "hipoteseDiagnostica",
            afirmacoes: [{ texto: "Lombalgia mecânica", fontes: [] }],
          },
        ],
      }),
    );
    expect(validateNote(parsed, TRECHOS).acceptable).toBe(false);
  });

  it("fonte repetida não bloqueia, só é registrada", () => {
    const parsed = parseNoteResponse(
      JSON.stringify({
        secoes: [
          {
            chave: "conduta",
            afirmacoes: [{ texto: "x", fontes: ["seg_c", "seg_c"] }],
          },
        ],
      }),
    );
    const v = validateNote(parsed, TRECHOS);
    expect(v.acceptable).toBe(true);
    expect(v.issues).toHaveLength(1);
  });
});

describe("seções", () => {
  it("queixa e história são obrigatórias; exame físico não", () => {
    const porChave = Object.fromEntries(SECOES.map((s) => [s.chave, s.obrigatoria]));
    expect(porChave["queixaPrincipal"]).toBe(true);
    expect(porChave["historiaDoencaAtual"]).toBe(true);
    // Preencher exame físico numa consulta onde ninguém examinou nada é a
    // fabricação que mais passa despercebida (§11 da documentação).
    expect(porChave["exameFisico"]).toBe(false);
  });

  it("dá título legível para cada chave", () => {
    expect(sectionTitle("queixaPrincipal")).toBe("Queixa principal");
  });

  it("a versão do prompt é gravável", () => {
    expect(PROMPT_VERSION).toMatch(/^nota-v\d+$/);
  });
});

describe("checkApproval", () => {
  const ancorada = { path: "conduta[0]", text: "Relaxante", sources: ["seg_c"] };
  const semFonte = { path: "hipoteseDiagnostica[0]", text: "Lombalgia", sources: [] };
  const inventada = {
    path: "exameFisico[0]",
    text: "Ausculta normal",
    sources: ["seg_x"],
  };

  it("aprova quando toda afirmação tem âncora válida", () => {
    expect(checkApproval([ancorada], TRECHOS).ok).toBe(true);
  });

  it("bloqueia afirmação sem fonte", () => {
    const r = checkApproval([ancorada, semFonte], TRECHOS);
    expect(r.ok).toBe(false);
    expect(r.pending).toEqual(["hipoteseDiagnostica[0]"]);
  });

  it("bloqueia afirmação que cita trecho inexistente", () => {
    expect(checkApproval([inventada], TRECHOS).ok).toBe(false);
  });

  // O caso que justifica o campo. Sem esta saída, o profissional precisaria
  // APAGAR informação correta para conseguir assinar — o pior resultado
  // possível de um mecanismo que existe para proteger o registro.
  it("libera a afirmação que o profissional assumiu", () => {
    const assumida = { ...semFonte, confirmedAt: "2026-09-16T01:00:00Z" };
    expect(checkApproval([ancorada, assumida], TRECHOS).ok).toBe(true);
  });

  it("assumir vale também para fonte inventada", () => {
    const assumida = { ...inventada, confirmedAt: "2026-09-16T01:00:00Z" };
    expect(checkApproval([assumida], TRECHOS).ok).toBe(true);
  });

  it("fonte repetida não impede a aprovação", () => {
    const repetida = { path: "conduta[1]", text: "x", sources: ["seg_c", "seg_c"] };
    expect(checkApproval([repetida], TRECHOS).ok).toBe(true);
  });

  it("lista todas as pendências, não só a primeira", () => {
    const r = checkApproval([semFonte, inventada], TRECHOS);
    expect(r.pending).toHaveLength(2);
  });

  it("nota vazia é aprovável — não há o que conferir", () => {
    expect(checkApproval([], TRECHOS).ok).toBe(true);
  });
});

describe("allStatements", () => {
  it("achata as seções preservando a ordem", () => {
    const r = allStatements([
      { statements: [{ path: "a[0]", text: "1", sources: [] }] },
      { statements: [{ path: "b[0]", text: "2", sources: [] }] },
    ]);
    expect(r.map((s) => s.path)).toEqual(["a[0]", "b[0]"]);
  });
});
