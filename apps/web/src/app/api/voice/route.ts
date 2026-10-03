import { randomUUID } from "node:crypto";

import { jobs, professionals } from "@scribe/db";
import {
  chaveDaAmostraDeVoz,
  quemProcessa,
  TIPO_IMPRESSAO_VOCAL,
  VOZ_CURTA,
  VOZ_FALHOU,
} from "@scribe/processamento";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { asCurrentProfessional } from "@/lib/auth";
import { storage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** ~4 MB. Trinta segundos de fala comprimida são uns 300 KB. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * O cadastro da voz, pela fila — como as consultas. Ver ADR-0005.
 *
 * Antes, esta rota chamava o motor no meio da requisição, e no site publicado
 * não há motor ao alcance: o cadastro nunca funcionava. Agora ela guarda a
 * amostra e enfileira; quem processa — o ajudante desta pessoa, ou a estação
 * — calcula a impressão vocal, grava os 256 números e apaga a amostra.
 *
 * A amostra NÃO fica guardada além disso: só o vetor (LGPD Art. 6º).
 */

const semSessao = () =>
  NextResponse.json({ error: "Sua sessão expirou. Entre de novo." }, { status: 401 });

/**
 * Sem `?tarefa`: há quem processe agora? A tela pergunta antes de pedir a
 * gravação — descobrir no fim, depois de ler as frases em voz alta, que nada
 * vai processá-la é o pior momento para descobrir.
 *
 * Com `?tarefa=<id>`: em que pé está o cadastro que a pessoa enviou.
 */
export async function GET(request: Request) {
  const tarefa = new URL(request.url).searchParams.get("tarefa");

  const resposta = await asCurrentProfessional(async (tx, me) => {
    const quem = await quemProcessa(tx, me.id);
    if (tarefa === null) {
      return { disponivel: quem.ajudante || quem.estacao, ...quem };
    }
    if (!/^[0-9a-f-]{36}$/i.test(tarefa)) return { estado: "desconhecida" as const };
    const [job] = await tx
      .select({ status: jobs.status, erro: jobs.lastError, kind: jobs.kind })
      .from(jobs)
      .where(and(eq(jobs.id, tarefa), eq(jobs.professionalId, me.id)))
      .limit(1);
    if (job === undefined || job.kind !== TIPO_IMPRESSAO_VOCAL) {
      return { estado: "desconhecida" as const };
    }
    switch (job.status) {
      case "pending":
        return { estado: "na_fila" as const, ...quem };
      case "running":
        return { estado: "processando" as const };
      case "done":
        return { estado: "pronta" as const };
      case "failed":
        // Só a recusa conhecida vai como está; o resto é detalhe técnico, e a
        // pessoa precisa saber só que pode tentar de novo.
        return {
          estado: "falhou" as const,
          mensagem: job.erro === VOZ_CURTA ? VOZ_CURTA : VOZ_FALHOU,
        };
    }
  });

  if (resposta === null) return semSessao();
  return NextResponse.json(resposta);
}

/** Recebe a amostra e enfileira o cadastro. Responde com a tarefa a acompanhar. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Envie a gravação da sua voz." },
      { status: 400 },
    );
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "A gravação chegou vazia ou grande demais. Grave de novo." },
      { status: 400 },
    );
  }
  const extensao = /\.([a-z0-9]{1,8})$/i.exec(file.name)?.[1]?.toLowerCase() ?? "webm";

  const resultado = await asCurrentProfessional(async (tx, me) => {
    const chave = chaveDaAmostraDeVoz(me.id, randomUUID(), extensao);
    // Guardar primeiro, enfileirar depois: um job que chega antes do arquivo
    // falha à toa.
    await storage.put(chave, new Uint8Array(await file.arrayBuffer()));
    const [job] = await tx
      .insert(jobs)
      .values({
        professionalId: me.id,
        kind: TIPO_IMPRESSAO_VOCAL,
        payload: { chave, nome: `voz.${extensao}` },
      })
      .returning({ id: jobs.id });
    return { tarefa: job?.id ?? null, ...(await quemProcessa(tx, me.id)) };
  });

  if (resultado === null) return semSessao();
  return NextResponse.json(resultado, { status: 202 });
}

/** Apaga a impressão vocal: direito do titular sobre o próprio dado. */
export async function DELETE() {
  const ok = await asCurrentProfessional(async (tx, me) => {
    await tx
      .update(professionals)
      .set({ voiceEmbedding: null, voiceEnrolledAt: null })
      .where(eq(professionals.id, me.id));
    return true;
  });
  if (ok === null) return semSessao();
  return NextResponse.json({ ok: true });
}
