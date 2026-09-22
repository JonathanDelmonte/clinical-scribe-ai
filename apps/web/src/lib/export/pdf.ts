import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import {
  marcaDaAfirmacao,
  tituloDaSecao,
  RODAPE,
  type AfirmacaoParaExportar,
  type CabecalhoDeExportacao,
  type SecaoParaExportar,
  type TrechoParaExportar,
} from "./texto";

/**
 * A nota clínica como PDF assinado.
 *
 * ## Por que um PDF de verdade, e não "imprimir a tela"
 *
 * A janela de impressão do navegador produziria algo parecido com menos
 * código. O que ela não produz é um **arquivo** que o profissional anexa a um
 * e-mail, guarda numa pasta e entrega ao paciente — nem consegue embutir a
 * assinatura dele. Exportar é entregar um artefato, não uma captura de tela.
 *
 * ## Por que pdf-lib
 *
 * Puro JavaScript, sem binário nativo e sem navegador sem cabeça. Um Puppeteer
 * aqui renderizaria HTML lindo e custaria ~300 MB de Chromium no contêiner do
 * worker, para gerar um documento de três páginas com texto e uma imagem.
 *
 * ## O limite do que este arquivo entrega
 *
 * `WinAnsiEncoding`, das fontes padrão, cobre o português inteiro — acentos,
 * cedilha, til. O que ele não cobre é caractere fora do Latin-1, e o pdf-lib
 * **lança** ao encontrar um: um emoji colado numa observação derrubaria a
 * exportação da consulta. Por isso o texto passa por `paraWinAnsi()` antes de
 * ser desenhado.
 *
 * E isto **não é assinatura digital ICP-Brasil**. É a imagem da assinatura e a
 * identificação de quem assina — o suficiente para o papel que o produto
 * ocupa hoje (§10: assistente que exporta para o prontuário certificado), e
 * insuficiente para ser o prontuário oficial. O rodapé não finge o contrário.
 */

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 56;
const LARGURA_UTIL = A4.largura - MARGEM * 2;

const CORPO = 10.5;
const TITULO_SECAO = 9;
const ENTRELINHA = 14;

const TINTA = rgb(0.12, 0.13, 0.16);
const APAGADO = rgb(0.45, 0.47, 0.5);

/**
 * Os caracteres que o `WinAnsiEncoding` acrescenta acima do Latin-1.
 *
 * O resto da tabela é `U+0000`–`U+00FF`, que cobre o português inteiro — os
 * acentos, o cedilha, o til. Estes são o que sobra: aspas tipográficas,
 * travessão, reticências, bullet.
 */
const EXTRAS_WINANSI = new Set([
  ..."\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030",
  ..."\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022",
  ..."\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178",
]);

export function paraWinAnsi(texto: string): string {
  let saida = "";
  for (const c of texto) {
    if (c.codePointAt(0)! <= 0xff || EXTRAS_WINANSI.has(c)) {
      saida += c;
      continue;
    }
    // Emoji, símbolo matemático, caractere de outro alfabeto. Trocar por "?"
    // é feio; deixar o pdf-lib lançar torna a consulta inteira inexportável
    // por causa de um caractere.
    saida += "?";
  }
  return saida;
}

/** Quebra o texto em linhas que cabem na largura, sem cortar palavra. */
export function quebrarLinhas(
  texto: string,
  fonte: PDFFont,
  tamanho: number,
  largura: number,
): string[] {
  const linhas: string[] = [];

  for (const paragrafo of texto.split("\n")) {
    let atual = "";
    for (const palavra of paragrafo.split(/\s+/).filter((p) => p !== "")) {
      const tentativa = atual === "" ? palavra : `${atual} ${palavra}`;
      if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) {
        atual = tentativa;
        continue;
      }
      if (atual !== "") linhas.push(atual);
      // Palavra sozinha maior que a linha (um URL, um código): entra assim
      // mesmo e transborda, o que é melhor que travar o laço procurando um
      // lugar para quebrar que não existe.
      atual = palavra;
    }
    linhas.push(atual);
  }

  return linhas;
}

interface Cursor {
  pagina: PDFPage;
  y: number;
}

export interface DocumentoParaPdf {
  readonly titulo: string;
  readonly cabecalho: CabecalhoDeExportacao;
  readonly secoes: readonly SecaoParaExportar[];
  readonly trechos: readonly TrechoParaExportar[];
  /** PNG da assinatura do profissional, se houver. */
  readonly assinatura: Uint8Array | null;
}

export async function gerarPdf(doc: DocumentoParaPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(paraWinAnsi(`${doc.titulo} — ${doc.cabecalho.paciente}`));
  pdf.setCreator("Consulta Viva");
  pdf.setProducer("Consulta Viva");

  const cursor: Cursor = { pagina: pdf.addPage([A4.largura, A4.altura]), y: 0 };
  cursor.y = A4.altura - MARGEM;

  function novaPagina() {
    cursor.pagina = pdf.addPage([A4.largura, A4.altura]);
    cursor.y = A4.altura - MARGEM;
  }

  function escrever(
    texto: string,
    opcoes: {
      fonte?: PDFFont;
      tamanho?: number;
      cor?: typeof TINTA;
      recuo?: number;
      espacoDepois?: number;
    } = {},
  ) {
    const fonte = opcoes.fonte ?? regular;
    const tamanho = opcoes.tamanho ?? CORPO;
    const recuo = opcoes.recuo ?? 0;
    const linhas = quebrarLinhas(
      paraWinAnsi(texto),
      fonte,
      tamanho,
      LARGURA_UTIL - recuo,
    );

    for (const linha of linhas) {
      if (cursor.y < MARGEM + ENTRELINHA * 3) novaPagina();
      cursor.pagina.drawText(linha, {
        x: MARGEM + recuo,
        y: cursor.y,
        size: tamanho,
        font: fonte,
        color: opcoes.cor ?? TINTA,
      });
      cursor.y -= ENTRELINHA;
    }

    cursor.y -= opcoes.espacoDepois ?? 0;
  }

  // ---- cabeçalho ----------------------------------------------------------
  escrever(doc.titulo.toUpperCase(), { fonte: negrito, tamanho: 13, espacoDepois: 6 });

  const { cabecalho: c } = doc;
  escrever(
    `Paciente: ${c.paciente}` +
      (c.nascimento === null ? "" : ` (nasc. ${c.nascimento})`),
  );
  escrever(
    `Profissional: ${c.profissional}` +
      (c.registro === null ? "" : ` — ${c.registro}`) +
      (c.especialidade === null ? "" : ` · ${c.especialidade}`),
  );
  escrever(
    `Consulta em ${c.dataDaConsulta.toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    })}` +
      (c.duracaoMs === null || c.duracaoMs <= 0
        ? ""
        : ` · gravação de ${Math.round(c.duracaoMs / 60_000)} min`),
    { espacoDepois: 10 },
  );

  linhaHorizontal(cursor, 12);

  // ---- seções -------------------------------------------------------------
  for (const secao of doc.secoes) {
    if (secao.statements.length === 0) continue;

    escrever(tituloDaSecao(secao.key).toUpperCase(), {
      fonte: negrito,
      tamanho: TITULO_SECAO,
      cor: APAGADO,
      espacoDepois: 2,
    });

    for (const afirmacao of secao.statements) {
      escrever(`• ${textoDaAfirmacao(afirmacao, doc.trechos)}`, { recuo: 8 });
    }
    cursor.y -= 8;
  }

  // ---- assinatura e rodapé ------------------------------------------------
  const alturaDoFecho = doc.assinatura === null ? 70 : 120;
  if (cursor.y < MARGEM + alturaDoFecho) novaPagina();

  cursor.y -= 18;

  if (doc.assinatura !== null) {
    try {
      const png = await pdf.embedPng(doc.assinatura);
      // Escalada para 150 pt de largura, mantendo proporção e sem passar de
      // 60 pt de altura — uma assinatura larga e baixa não pode empurrar o
      // rodapé para fora da página.
      const escala = Math.min(150 / png.width, 60 / png.height);
      cursor.y -= png.height * escala;
      cursor.pagina.drawImage(png, {
        x: MARGEM,
        y: cursor.y,
        width: png.width * escala,
        height: png.height * escala,
      });
      cursor.y -= 6;
    } catch {
      // PNG corrompido não impede a exportação do documento clínico.
    }
  }

  linhaHorizontal(cursor, 12, 200);
  escrever(c.profissional, { tamanho: 9.5 });
  if (c.registro !== null) escrever(c.registro, { tamanho: 9.5, cor: APAGADO });

  cursor.y -= 10;
  escrever(RODAPE, { tamanho: 8, cor: APAGADO });

  return pdf.save();

  function linhaHorizontal(cur: Cursor, espaco: number, largura = LARGURA_UTIL) {
    cur.pagina.drawLine({
      start: { x: MARGEM, y: cur.y + 4 },
      end: { x: MARGEM + largura, y: cur.y + 4 },
      thickness: 0.5,
      color: rgb(0.85, 0.86, 0.88),
    });
    cur.y -= espaco;
  }
}

function textoDaAfirmacao(
  a: AfirmacaoParaExportar,
  trechos: readonly TrechoParaExportar[],
): string {
  return `${a.text} ${marcaDaAfirmacao(a, trechos)}`;
}
