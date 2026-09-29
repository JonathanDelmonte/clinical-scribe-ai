/**
 * O estado de uma consulta, dito em palavras que qualquer pessoa entende.
 *
 * "transcribing" e "generating" são nomes de etapa do worker; quem está na
 * tela quer saber o que está acontecendo com a consulta dela. Por isso o
 * rótulo é um verbo do dia a dia — "ouvindo a gravação", "escrevendo a nota" —
 * e a cor só acompanha a palavra, nunca a substitui.
 */

export type TomDoEstado =
  "neutro" | "gravando" | "processando" | "aviso" | "ok" | "erro";

export interface EstadoDaConsulta {
  readonly rotulo: string;
  readonly tom: TomDoEstado;
}

const ESTADOS: Record<string, EstadoDaConsulta> = {
  draft: { rotulo: "Rascunho", tom: "neutro" },
  recording: { rotulo: "Gravando", tom: "gravando" },
  uploaded: { rotulo: "Na fila", tom: "processando" },
  transcribing: { rotulo: "Ouvindo a gravação", tom: "processando" },
  generating: { rotulo: "Escrevendo a nota", tom: "processando" },
  ready_for_review: { rotulo: "Pronta para revisar", tom: "aviso" },
  approved: { rotulo: "Aprovada", tom: "ok" },
  failed: { rotulo: "Algo deu errado", tom: "erro" },
};

export function estadoDaConsulta(status: string): EstadoDaConsulta {
  return ESTADOS[status] ?? { rotulo: status, tom: "neutro" };
}

/** A classe de `globals.css` que pinta cada tom. */
export const CLASSE_DO_TOM: Record<TomDoEstado, string> = {
  neutro: "",
  gravando: "ficha-gravando",
  processando: "ficha-processando",
  aviso: "ficha-aviso",
  ok: "ficha-ok",
  erro: "ficha-erro",
};
