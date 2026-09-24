import {
  lerCabecalhoDoEnvelope,
  MAX_BYTES_ENVELOPE,
} from "@scribe/audio-browser/envelope";
import {
  lerEstadoDoSegundoMicrofone,
  type EstadoDoSegundoMicrofone,
} from "@scribe/core";
import { jobs, sessions, transcriptSegments } from "@scribe/db";
import { secondChannelKey } from "@scribe/storage";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { ACOES, auditar } from "@/lib/audit";
import { MAX_CORPO_BUFFERIZADO_BYTES } from "@/lib/audio";
import { asCurrentProfessional } from "@/lib/auth";
import { limitarPorProfissional } from "@/lib/limites";
import { storage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Estados em que o worker ainda está transcrevendo ou gerando a nota. */
const EM_PROCESSAMENTO = ["uploaded", "transcribing", "generating"];
const JOB_ATIVO = ["pending", "running"] as const;

/**
 * Recebe a medida do segundo microfone e põe o processamento na fila.
 *
 * O corpo NÃO é áudio: é a energia do segundo microfone a cada 5 ms, medida no
 * navegador (ver `envelope.ts` em @scribe/audio-browser). A gravação do lado
 * do paciente nunca chega aqui. `?perto=paciente` ou `?perto=profissional`
 * diz onde o segundo aparelho ficou — é por isso que o papel de cada fala é
 * decidido, então não há valor padrão: sem essa resposta, não há pedido.
 *
 * ## O que é recusado, e por quê
 *
 * - **Nota aprovada**: é registro assinado. Mudar quem disse o quê debaixo
 *   dela alteraria o que o profissional atestou.
 * - **Transcrição ou nota em andamento**: o worker reescreveria papéis
 *   enquanto outro job os lê — a nota sairia com metade de cada atribuição.
 * - **Sem transcrição**: os turnos dos dois microfones só dizem quem falou
 *   QUANDO; sem trechos, não há a quem atribuir.
 * - **Áudio apagado pela retenção**: o motor alinha a medida com o áudio da
 *   sessão, e ele não existe mais.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const barrado = await limitarPorProfissional("upload");
  if (barrado !== null) return barrado;

  const perto = new URL(request.url).searchParams.get("perto");
  const segundoPerto =
    perto === "paciente" ? "patient" : perto === "profissional" ? "professional" : null;
  if (segundoPerto === null) {
    return NextResponse.json(
      {
        error:
          "diga onde o segundo microfone ficou: perto do paciente ou do profissional",
      },
      { status: 400 },
    );
  }

  // Recusar pelo tamanho ANUNCIADO, antes de ler: acima do teto do Next o
  // corpo chegaria cortado, e ler um corpo cortado já é tarde.
  const teto = Math.min(MAX_BYTES_ENVELOPE, MAX_CORPO_BUFFERIZADO_BYTES);
  const anunciado = Number(request.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(anunciado) && anunciado > teto) {
    return NextResponse.json(
      {
        error:
          "medida grande demais: o segundo microfone aceita até 4 horas de gravação",
      },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > teto) {
    return NextResponse.json(
      {
        error:
          "medida grande demais: o segundo microfone aceita até 4 horas de gravação",
      },
      { status: 413 },
    );
  }
  const leitura = lerCabecalhoDoEnvelope(bytes);
  if (!leitura.ok) {
    return NextResponse.json({ error: leitura.erro }, { status: 400 });
  }

  const resultado = await asCurrentProfessional(async (tx, me) => {
    // Sob RLS, sessão de outro profissional simplesmente não é encontrada.
    const [sessao] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    if (sessao === undefined)
      return { status: 404, error: "sessão não encontrada" } as const;
    if (sessao.audioPath === null) {
      return { status: 409, error: "esta consulta não tem áudio" } as const;
    }
    if (sessao.audioDeletedAt !== null) {
      return {
        status: 409,
        error: "o áudio desta consulta já foi apagado pela política de retenção",
      } as const;
    }
    if (sessao.status === "approved") {
      return {
        status: 409,
        error:
          "a nota desta consulta já foi aprovada — quem falou não muda depois da assinatura",
      } as const;
    }
    if (EM_PROCESSAMENTO.includes(sessao.status)) {
      return { status: 409, error: "espere a transcrição terminar" } as const;
    }

    const [trechos] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.sessionId, sessao.id));
    if ((trechos?.n ?? 0) === 0) {
      return { status: 409, error: "a consulta ainda não tem transcrição" } as const;
    }

    const [ocupado] = await tx
      .select({ kind: jobs.kind })
      .from(jobs)
      .where(
        and(
          eq(jobs.sessionId, sessao.id),
          inArray(jobs.kind, [
            "diarize_channels",
            "generate_note",
            "generate_objective",
          ]),
          inArray(jobs.status, [...JOB_ATIVO]),
        ),
      )
      .limit(1);
    if (ocupado !== undefined) {
      return {
        status: 409,
        error:
          ocupado.kind === "diarize_channels"
            ? "o segundo microfone desta consulta já está sendo processado"
            : "espere o documento que está sendo gerado terminar",
      } as const;
    }

    // Chave fixa por sessão: enviar de novo substitui a medida anterior, sem
    // deixar a velha para trás. O arquivo vai antes do banco — se o banco
    // falhar depois, sobra um arquivo que o próximo envio sobrescreve e que a
    // exclusão da conta leva junto (está sob o prefixo do dono).
    const chave = secondChannelKey(me.id, sessao.id);
    await storage.put(chave, bytes);

    const pedido: EstadoDoSegundoMicrofone = {
      estado: "na_fila",
      segundoPerto,
      enviadoEm: new Date().toISOString(),
      duracaoS: Math.round(leitura.duracaoS),
    };

    await tx
      .update(sessions)
      .set({ secondChannelPath: chave, channelDiarization: pedido })
      .where(eq(sessions.id, sessao.id));

    await tx.insert(jobs).values({
      professionalId: me.id,
      sessionId: sessao.id,
      kind: "diarize_channels",
    });

    await auditar(tx, {
      acao: ACOES.segundoMicrofoneEnviado,
      entidade: "sessions",
      entidadeId: sessao.id,
      metadados: { segundoPerto, duracaoS: pedido.duracaoS },
    });

    return { status: 202, estado: pedido } as const;
  });

  if (resultado === null) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const { status, ...corpo } = resultado;
  return NextResponse.json(corpo, { status });
}

/**
 * O estado do segundo microfone — o que a tela consulta enquanto o worker
 * processa.
 *
 * Rota própria, e não um campo a mais na consulta da sessão: a tela só
 * precisa perguntar isto nos segundos entre o envio e o resultado, e cada
 * pergunta à rota da sessão traria a transcrição inteira junto.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const resultado = await asCurrentProfessional(async (tx) => {
    const [sessao] = await tx
      .select({ channelDiarization: sessions.channelDiarization })
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    if (sessao === undefined) return null;

    const [job] = await tx
      .select({ status: jobs.status, error: jobs.lastError })
      .from(jobs)
      .where(and(eq(jobs.sessionId, id), eq(jobs.kind, "diarize_channels")))
      .orderBy(desc(jobs.createdAt))
      .limit(1);

    return {
      estado: lerEstadoDoSegundoMicrofone(sessao.channelDiarization),
      job: job ?? null,
    };
  });

  if (resultado === null || resultado === undefined) {
    return NextResponse.json({ error: "sessão não encontrada" }, { status: 404 });
  }
  return NextResponse.json(resultado);
}
