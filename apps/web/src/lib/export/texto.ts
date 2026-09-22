import { formatTimestamp, sectionTitle, type SecaoChave } from "@scribe/core";

/**
 * A nota clínica como texto puro, pronto para colar no prontuário.
 *
 * ## Por que texto puro é o formato mais importante deste produto
 *
 * A §10 da documentação define a jogada do MVP: ser um **assistente de
 * documentação que exporta** para o prontuário certificado que o profissional
 * já usa — e não o prontuário oficial, que exigiria certificação SBIS/NGS2.
 * O botão "copiar" é essa estratégia inteira, em uma função.
 *
 * ## Por que os tempos vão junto
 *
 * Cada afirmação carrega o minuto do áudio que a sustenta. Colada num
 * prontuário de terceiro, a nota perde o clique que toca o trecho — mas não
 * precisa perder a rastreabilidade. `[07:42]` diz onde conferir, e é o que
 * mantém honesto um documento produzido por IA depois que ele sai daqui.
 *
 * Função pura, sem banco e sem rede: é a peça que decide como um registro
 * clínico fica escrito, e isso merece teste direto.
 */

export interface AfirmacaoParaExportar {
  readonly text: string;
  readonly sources: readonly string[];
  /** Quando o profissional assumiu a afirmação sem âncora válida. */
  readonly confirmedAt?: string | undefined;
}

export interface SecaoParaExportar {
  readonly key: string;
  readonly statements: readonly AfirmacaoParaExportar[];
}

export interface TrechoParaExportar {
  readonly id: string;
  readonly startMs: number;
}

export interface CabecalhoDeExportacao {
  readonly paciente: string;
  readonly nascimento: string | null;
  readonly profissional: string;
  readonly registro: string | null;
  readonly especialidade: string | null;
  readonly dataDaConsulta: Date;
  readonly duracaoMs: number | null;
}

/**
 * O rodapé que declara a origem do documento.
 *
 * Não é disclaimer defensivo: é o que a §11 da documentação exige na prática.
 * Um texto clínico que circula sem dizer como foi produzido convida a ser lido
 * como se tivesse sido digitado por quem assina — e 62% dos achados fabricados
 * passaram despercebidos justamente por soarem críveis.
 */
export const RODAPE =
  "Documento produzido com auxílio de inteligência artificial a partir da " +
  "gravação da consulta, e revisado e aprovado pelo profissional que o assina. " +
  "Os tempos entre colchetes indicam o trecho do áudio que sustenta cada " +
  "afirmação.";

function dataBr(d: Date): string {
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function duracao(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null;
  const minutos = Math.round(ms / 60_000);
  return `${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;
}

/**
 * Os tempos das fontes de uma afirmação, em ordem e sem repetir.
 *
 * IDs que não existem entre os trechos são simplesmente omitidos. A conferência
 * determinística (`validateCitations`) é quem barra uma nota nesse estado antes
 * de ela chegar à aprovação; aqui, no documento final, inventar um tempo seria
 * pior do que não mostrar nenhum.
 */
export function temposDasFontes(
  sources: readonly string[],
  trechos: readonly TrechoParaExportar[],
): string[] {
  const porId = new Map(trechos.map((t) => [t.id, t.startMs]));
  const ms = sources
    .map((id) => porId.get(id))
    .filter((v): v is number => v !== undefined);

  return [...new Set(ms)].sort((a, b) => a - b).map(formatTimestamp);
}

/**
 * A marca que acompanha a afirmação: os tempos, ou a falta deles.
 *
 * Os três casos são diferentes e nenhum pode virar silêncio:
 *
 * - **Com âncora** — os minutos do áudio, que é o caso normal.
 * - **Assumida** — o profissional assinou uma afirmação sem âncora válida. A
 *   responsabilidade foi transferida explicitamente no fluxo de aprovação, e
 *   essa transferência precisa sobreviver à exportação.
 * - **Sem âncora** — é o caso perigoso, e o mais fácil de esconder sem querer.
 *   Uma afirmação cujas fontes não existem entre os trechos é exatamente a
 *   fabricação que a §11 da documentação aponta como risco nº 1. Omitir a
 *   marca a deixaria visualmente idêntica a uma frase sem citação — e 62% dos
 *   achados inventados passaram despercebidos por soarem críveis.
 */
export function marcaDaAfirmacao(
  a: AfirmacaoParaExportar,
  trechos: readonly TrechoParaExportar[],
): string {
  const tempos = temposDasFontes(a.sources, trechos);
  if (tempos.length > 0) return `[${tempos.join(", ")}]`;
  if (a.confirmedAt !== undefined) return "[assumido pelo profissional]";
  return "[sem âncora no áudio]";
}

function linhaDaAfirmacao(
  a: AfirmacaoParaExportar,
  trechos: readonly TrechoParaExportar[],
): string {
  return `- ${a.text} ${marcaDaAfirmacao(a, trechos)}`;
}

/**
 * A nota inteira, como texto.
 *
 * Seções vazias não aparecem. É a mesma regra do prompt e pelo mesmo motivo:
 * um "Exame físico" com um travessão embaixo, numa consulta em que ninguém
 * examinou nada, é uma seção que parece ter sido preenchida.
 */
export function notaComoTexto(
  cabecalho: CabecalhoDeExportacao,
  secoes: readonly SecaoParaExportar[],
  trechos: readonly TrechoParaExportar[],
): string {
  const linhas: string[] = [];

  linhas.push(`CONSULTA — ${dataBr(cabecalho.dataDaConsulta)}`);
  linhas.push("");
  linhas.push(
    `Paciente: ${cabecalho.paciente}` +
      (cabecalho.nascimento === null ? "" : ` (nasc. ${cabecalho.nascimento})`),
  );
  linhas.push(
    `Profissional: ${cabecalho.profissional}` +
      (cabecalho.registro === null ? "" : ` — ${cabecalho.registro}`) +
      (cabecalho.especialidade === null ? "" : ` · ${cabecalho.especialidade}`),
  );

  const tempo = duracao(cabecalho.duracaoMs);
  if (tempo !== null) linhas.push(`Duração da gravação: ${tempo}`);

  for (const secao of secoes) {
    if (secao.statements.length === 0) continue;
    linhas.push("");
    linhas.push(tituloDaSecao(secao.key).toUpperCase());
    for (const a of secao.statements) linhas.push(linhaDaAfirmacao(a, trechos));
  }

  linhas.push("");
  linhas.push("—");
  linhas.push(RODAPE);

  return linhas.join("\n");
}

/** Um documento de objetivo (receita, encaminhamento, resumo) como texto. */
export function objetivoComoTexto(
  cabecalho: CabecalhoDeExportacao,
  titulo: string,
  itens: readonly AfirmacaoParaExportar[],
  trechos: readonly TrechoParaExportar[],
): string {
  const linhas: string[] = [];

  linhas.push((titulo === "" ? "DOCUMENTO" : titulo).toUpperCase());
  linhas.push("");
  linhas.push(`Paciente: ${cabecalho.paciente}`);
  linhas.push(
    `Profissional: ${cabecalho.profissional}` +
      (cabecalho.registro === null ? "" : ` — ${cabecalho.registro}`),
  );
  linhas.push(`Data: ${dataBr(cabecalho.dataDaConsulta)}`);
  linhas.push("");

  for (const item of itens) linhas.push(linhaDaAfirmacao(item, trechos));

  linhas.push("");
  linhas.push("—");
  linhas.push(RODAPE);

  return linhas.join("\n");
}

/**
 * O título legível de uma seção.
 *
 * `sectionTitle` de `@scribe/core` conhece as seções da nota clínica; uma
 * chave desconhecida — de um documento de objetivo, ou de uma versão futura do
 * prompt — cai no próprio nome em vez de sumir do documento.
 */
export function tituloDaSecao(key: string): string {
  const conhecida = sectionTitle(key as SecaoChave);
  return conhecida === key ? key : conhecida;
}
