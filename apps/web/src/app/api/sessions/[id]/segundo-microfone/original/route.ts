import {
  secondChannelOriginalKey,
  secondChannelPartKey,
  secondChannelPartsPrefix,
} from "@scribe/storage";
import { NextResponse } from "next/server";
import { z } from "zod";

import { EXTENSOES_ACEITAS, MAX_AUDIO_BYTES } from "@/lib/audio";
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
} from "../comum";

export const dynamic = "force-dynamic";

const Corpo = z.object({
  total: z.number().int().min(1).max(2000),
  extensao: z.string().max(8),
});

/**
 * Monta a gravação do segundo celular que o navegador não conseguiu ler, e a
 * entrega ao worker para medir.
 *
 * O caminho de reserva. O normal é o navegador medir o volume e mandar só a
 * medida (a rota ao lado); quando o formato é um que ele não lê — AMR de
 * gravador antigo, WMA, ALAC do iPhone —, a gravação sobe inteira, o motor a
 * mede com o ffmpeg, e o worker a apaga assim que a medida está gravada. O
 * que fica guardado no fim é o mesmo nos dois caminhos: só a medida.
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

  const parsed = Corpo.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  }
  const extensao = parsed.data.extensao.replace(/^\./, "").toLowerCase();
  if (!EXTENSOES_ACEITAS.has(extensao)) {
    return NextResponse.json(
      { error: `arquivos .${extensao} não são de áudio` },
      { status: 415 },
    );
  }

  const resultado = await asCurrentProfessional(
    async (tx, me): Promise<Recusa | Aceito> => {
      const aceita = await sessaoQueAceita(tx, id, true);
      if (!("sessao" in aceita)) return aceita;
      const { sessao } = aceita;

      const presentes = new Set(
        await storage.list(secondChannelPartsPrefix(me.id, sessao.id)),
      );
      const faltando: number[] = [];
      for (let i = 0; i < parsed.data.total; i++) {
        if (!presentes.has(secondChannelPartKey(me.id, sessao.id, i))) faltando.push(i);
      }
      if (faltando.length > 0) {
        return {
          status: 409,
          error:
            faltando.length === 1
              ? "falta 1 pedaço da gravação"
              : `faltam ${faltando.length} pedaços da gravação`,
          faltando,
        };
      }

      // Em ordem de índice, não na ordem em que o armazenamento listou.
      const pedacos: Uint8Array[] = [];
      let tamanho = 0;
      for (let i = 0; i < parsed.data.total; i++) {
        const bytes = await storage.get(secondChannelPartKey(me.id, sessao.id, i));
        tamanho += bytes.byteLength;
        if (tamanho > MAX_AUDIO_BYTES) {
          return { status: 413, error: "gravação grande demais" };
        }
        pedacos.push(bytes);
      }
      const inteiro = new Uint8Array(tamanho);
      let posicao = 0;
      for (const pedaco of pedacos) {
        inteiro.set(pedaco, posicao);
        posicao += pedaco.byteLength;
      }

      const chave = secondChannelOriginalKey(me.id, sessao.id, extensao);
      await storage.put(chave, inteiro);

      // A duração só se sabe depois de o motor ler o arquivo; o worker a grava.
      const { pedido, anterior } = await enfileirarSegundoMicrofone(
        tx,
        me,
        sessao,
        chave,
        segundoPerto,
        0,
        true,
      );

      // Os pedaços saem depois de o original inteiro estar gravado e apontado.
      await Promise.all(
        [...presentes].map((p) => storage.remove(p).catch(() => undefined)),
      );
      return { estado: pedido, anterior };
    },
  );

  if (resultado === null) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  if (!("estado" in resultado)) {
    const { status, ...corpo } = resultado;
    return NextResponse.json(corpo, { status });
  }
  await apagarAnterior(resultado.anterior);
  return NextResponse.json({ estado: resultado.estado }, { status: 202 });
}
