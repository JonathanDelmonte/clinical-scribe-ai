import {
  secondChannelPartKey,
  secondChannelPartsManifestKey,
  secondChannelPartsPrefix,
  type ManifestoDePartes,
} from "@scribe/storage";
import { NextResponse } from "next/server";
import { z } from "zod";

import { EXTENSOES_ACEITAS } from "@/lib/audio";
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
 * Entrega ao worker, para medir, a gravação do segundo celular que o
 * navegador não conseguiu ler.
 *
 * O caminho de reserva. O normal é o navegador medir o volume e mandar só a
 * medida (a rota ao lado); quando o formato é um que ele não lê — AMR de
 * gravador antigo, WMA, ALAC do iPhone —, a gravação sobe inteira, o motor a
 * mede com o ffmpeg, e o worker a apaga assim que a medida está gravada. O
 * que fica guardado no fim é o mesmo nos dois caminhos: só a medida.
 *
 * Os pedaços NÃO são juntados aqui, pelo mesmo motivo do áudio principal
 * (ver a rota de finalização): juntar é ler e regravar a gravação inteira
 * dentro de uma função com tempo e memória contados, e o arquivo juntado
 * esbarraria nos 50 MB por arquivo do armazenamento. Esta rota confere que
 * todos chegaram e escreve o manifesto; o worker junta.
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

      const manifesto: ManifestoDePartes = { partes: parsed.data.total, extensao };
      const chave = secondChannelPartsManifestKey(me.id, sessao.id);
      await storage.put(
        chave,
        new TextEncoder().encode(JSON.stringify(manifesto)) as Uint8Array<ArrayBuffer>,
      );

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
      // Os pedaços ficam: são o arquivo, até o worker juntá-los e medi-los.
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
