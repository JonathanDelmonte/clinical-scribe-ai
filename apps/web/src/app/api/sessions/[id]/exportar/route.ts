import { documents, patients, sessions, transcriptSegments } from "@scribe/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";
import { gerarPdf } from "@/lib/export/pdf";
import {
  notaComoTexto,
  objetivoComoTexto,
  type AfirmacaoParaExportar,
  type CabecalhoDeExportacao,
  type SecaoParaExportar,
} from "@/lib/export/texto";
import { dataParaExibicao, dataParaFormulario } from "@/lib/patients";
import { storage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Exporta um documento da consulta — texto puro ou PDF.
 *
 * Os dois formatos saem da mesma leitura e do mesmo conteúdo. É por isso que
 * `lib/export/texto.ts` tem funções puras: o que decide como um registro
 * clínico fica escrito não pode viver dentro de uma rota, onde só é exercitado
 * por quem abre o navegador.
 *
 * `documento=` escolhe qual: `nota` (o padrão) ou o ID de um documento de
 * objetivo — receita, encaminhamento, resumo para o paciente.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const formato = url.searchParams.get("formato") ?? "texto";
  const documento = url.searchParams.get("documento") ?? "nota";

  if (formato !== "texto" && formato !== "pdf") {
    return NextResponse.json({ error: "formato inválido" }, { status: 400 });
  }

  const dados = await asCurrentProfessional(async (tx, me) => {
    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    if (session === undefined) return { error: "sessão não encontrada" } as const;

    const [patient] = await tx
      .select()
      .from(patients)
      .where(eq(patients.id, session.patientId))
      .limit(1);

    /**
     * A versão MAIS RECENTE, aprovada ou não.
     *
     * Exportar só o aprovado pareceria mais seguro e seria pior na prática:
     * quem clica em exportar durante a revisão receberia um documento antigo
     * sem entender por quê. O rodapé diz que o documento foi revisado por quem
     * assina; a tela é que decide quando oferecer o botão.
     */
    const [doc] =
      documento === "nota"
        ? await tx
            .select()
            .from(documents)
            .where(
              and(
                eq(documents.sessionId, session.id),
                eq(documents.type, "clinical_note"),
              ),
            )
            .orderBy(desc(documents.createdAt))
            .limit(1)
        : await tx
            .select()
            .from(documents)
            .where(
              and(eq(documents.sessionId, session.id), eq(documents.id, documento)),
            )
            .limit(1);

    if (doc === undefined) return { error: "documento não encontrado" } as const;

    const trechos = await tx
      .select({ id: transcriptSegments.id, startMs: transcriptSegments.startMs })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.sessionId, session.id))
      .orderBy(asc(transcriptSegments.startMs));

    return { session, patient: patient ?? null, doc, trechos, me } as const;
  });

  if (dados === null) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  if ("error" in dados) {
    return NextResponse.json({ error: dados.error }, { status: 404 });
  }

  const { session, patient, doc, trechos, me } = dados;

  const nascimento = patient?.birthDate ?? null;
  const cabecalho: CabecalhoDeExportacao = {
    paciente: patient?.name ?? "—",
    nascimento:
      nascimento === null ? null : dataParaExibicao(dataParaFormulario(nascimento)),
    profissional: me.name,
    registro: me.professionalRegistry,
    especialidade: me.specialty,
    dataDaConsulta: session.startedAt ?? session.createdAt,
    duracaoMs: session.durationMs,
  };

  const conteudo = lerConteudo(doc.content);

  const ehNota = doc.type === "clinical_note";
  const titulo = ehNota ? "Nota clínica" : conteudo.title;

  const texto = ehNota
    ? notaComoTexto(cabecalho, conteudo.sections, trechos)
    : objetivoComoTexto(cabecalho, conteudo.title, conteudo.items, trechos);

  const nomeBase = nomeDoArquivo(titulo, cabecalho.paciente, cabecalho.dataDaConsulta);

  if (formato === "texto") {
    return new Response(texto, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${nomeBase}.txt"`,
        // Documento clínico nunca encosta num cache compartilhado.
        "cache-control": "private, no-store",
      },
    });
  }

  const assinatura =
    me.signatureUrl === null
      ? null
      : await storage.get(me.signatureUrl).catch(() => null);

  const pdf = await gerarPdf({
    titulo,
    cabecalho,
    secoes: ehNota
      ? conteudo.sections
      : [{ key: conteudo.title, statements: conteudo.items }],
    trechos,
    assinatura,
  });

  return new Response(pdf as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${nomeBase}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}

/**
 * Lê o `content` do documento sem confiar nele.
 *
 * O conteúdo é `jsonb` produzido por um modelo de linguagem e gravado meses
 * atrás, possivelmente por uma versão anterior do prompt. Um `as` aqui
 * transformaria um campo ausente num `undefined.map is not a function` no meio
 * da exportação de um registro clínico.
 */
function lerConteudo(bruto: unknown): {
  title: string;
  sections: SecaoParaExportar[];
  items: AfirmacaoParaExportar[];
} {
  const vazio = { title: "Documento", sections: [], items: [] };
  if (typeof bruto !== "object" || bruto === null) return vazio;

  const c = bruto as { title?: unknown; sections?: unknown; items?: unknown };

  return {
    title: typeof c.title === "string" && c.title !== "" ? c.title : "Documento",
    sections: Array.isArray(c.sections) ? c.sections.map(lerSecao) : [],
    items: Array.isArray(c.items) ? c.items.map(lerAfirmacao) : [],
  };
}

function lerSecao(bruto: unknown): SecaoParaExportar {
  const s = (typeof bruto === "object" && bruto !== null ? bruto : {}) as {
    key?: unknown;
    statements?: unknown;
  };
  return {
    key: typeof s.key === "string" ? s.key : "",
    statements: Array.isArray(s.statements) ? s.statements.map(lerAfirmacao) : [],
  };
}

function lerAfirmacao(bruto: unknown): AfirmacaoParaExportar {
  const a = (typeof bruto === "object" && bruto !== null ? bruto : {}) as {
    text?: unknown;
    sources?: unknown;
    confirmedAt?: unknown;
  };
  return {
    text: typeof a.text === "string" ? a.text : "",
    sources: Array.isArray(a.sources)
      ? a.sources.filter((s): s is string => typeof s === "string")
      : [],
    confirmedAt: typeof a.confirmedAt === "string" ? a.confirmedAt : undefined,
  };
}

/**
 * Nome do arquivo baixado.
 *
 * Sem acento, sem espaço e sem aspas: o `content-disposition` não escapa nada,
 * e um nome com aspas quebra o cabeçalho — o navegador salva "download" e
 * ninguém entende por quê. O nome do paciente entra porque a pasta de
 * downloads de um consultório acumula dezenas destes.
 */
function nomeDoArquivo(titulo: string, paciente: string, data: Date): string {
  const limpar = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 40);

  const dia = data.toISOString().slice(0, 10);
  return [limpar(titulo), limpar(paciente), dia].filter((p) => p !== "").join("_");
}
