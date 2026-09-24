import {
  lerCabecalhoDoEnvelope,
  MAX_BYTES_ENVELOPE,
} from "@scribe/audio-browser/envelope";
import { lerEstadoDoSegundoMicrofone } from "@scribe/core";
import { jobs, sessions } from "@scribe/db";
import { secondChannelKey } from "@scribe/storage";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { MAX_CORPO_BUFFERIZADO_BYTES } from "@/lib/audio";
import { asCurrentProfessional } from "@/lib/auth";
import { limitarPorProfissional } from "@/lib/limites";
import { storage } from "@/lib/storage";

import {
  apagarAnterior,
  enfileirarSegundoMicrofone,
  ladoDoPedido,
  sessaoQueAceita,
  type Aceito,
  type Recusa,
} from "./comum";

export const dynamic = "force-dynamic";

/**
 * Recebe a medida do segundo microfone e põe o processamento na fila.
 *
 * O corpo NÃO é áudio: é a energia do segundo microfone a cada 5 ms, medida no
 * navegador (ver `envelope.ts` em @scribe/audio-browser). A gravação do lado
 * do paciente nunca chega aqui. `?perto=paciente` ou `?perto=profissional`
 * diz onde o segundo aparelho ficou — é por isso que o papel de cada fala é
 * decidido, então não há valor padrão: sem essa resposta, não há pedido.
 *
 * Quando o navegador não consegue ler o formato do celular, o caminho é outro
 * — `partes/` e `original/`, onde quem mede é o motor. O que se recusa é o
 * mesmo nos dois: ver `sessaoQueAceita`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const barrado = await limitarPorProfissional("upload");
  if (barrado !== null) return barrado;

  const segundoPerto = ladoDoPedido(request.url);
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

  const resultado = await asCurrentProfessional(
    async (tx, me): Promise<Recusa | Aceito> => {
      const aceita = await sessaoQueAceita(tx, id, true);
      if (!("sessao" in aceita)) return aceita;

      // Chave fixa por sessão: enviar de novo substitui a medida anterior. O
      // arquivo vai antes do banco — se o banco falhar depois, sobra um arquivo
      // que o próximo envio sobrescreve e que a exclusão da conta leva junto
      // (está sob o prefixo do dono).
      const chave = secondChannelKey(me.id, aceita.sessao.id);
      await storage.put(chave, bytes);

      const { pedido, anterior } = await enfileirarSegundoMicrofone(
        tx,
        me,
        aceita.sessao,
        chave,
        segundoPerto,
        leitura.duracaoS,
        false,
      );
      return { estado: pedido, anterior };
    },
  );

  if (resultado === null) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  if (!("estado" in resultado)) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  await apagarAnterior(resultado.anterior);
  return NextResponse.json({ estado: resultado.estado }, { status: 202 });
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
