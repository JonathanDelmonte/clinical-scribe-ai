import "server-only";

import type { EstadoDoSegundoMicrofone, LadoDoSegundo } from "@scribe/core";
import { jobs, sessions, transcriptSegments } from "@scribe/db";
import { and, eq, inArray, sql } from "drizzle-orm";

import { ACOES, auditar } from "@/lib/audit";
import type { Professional, Tx } from "@/lib/auth";
import { storage } from "@/lib/storage";

/**
 * O que as rotas do segundo microfone compartilham.
 *
 * São três portas para o mesmo pedido: a medida pronta (o navegador leu o
 * arquivo e mediu), e os pedaços e a montagem do original (o navegador não
 * leu o formato, e quem mede é o motor). As três precisam recusar as mesmas
 * coisas e registrar o pedido do mesmo jeito — uma regra que existisse em
 * duas cópias acabaria diferente numa delas.
 */

type Sessao = typeof sessions.$inferSelect;

export interface Recusa {
  readonly status: number;
  readonly error: string;
  /** Pedaços que não chegaram — o cliente reenvia só esses. */
  readonly faltando?: readonly number[];
}

export interface Aceito {
  readonly estado: EstadoDoSegundoMicrofone;
  /** O arquivo que a sessão deixou de apontar; ver `apagarAnterior`. */
  readonly anterior: string | null;
}

/** `?perto=paciente` → `"patient"`. `null` quando a resposta não veio. */
export function ladoDoPedido(url: string): LadoDoSegundo | null {
  const perto = new URL(url).searchParams.get("perto");
  return perto === "paciente"
    ? "patient"
    : perto === "profissional"
      ? "professional"
      : null;
}

/** Estados em que o worker ainda está transcrevendo ou gerando a nota. */
const EM_PROCESSAMENTO = ["uploaded", "transcribing", "generating"];

/**
 * A sessão, se ela pode receber o segundo microfone agora; senão, por quê.
 *
 * - **Nota aprovada**: é registro assinado. Mudar quem disse o quê debaixo
 *   dela alteraria o que o profissional atestou.
 * - **Áudio apagado pela retenção**: o motor alinha a medida com o áudio da
 *   sessão, e ele não existe mais.
 *
 * `completa` acrescenta o que só importa na hora de enfileirar — cada pedaço
 * de um envio não precisa perguntar de novo pela transcrição inteira:
 *
 * - **Transcrição ou documento em andamento**: o worker reescreveria papéis
 *   enquanto outro job os lê, e a nota sairia com metade de cada atribuição.
 * - **Sem transcrição**: os turnos dos dois microfones dizem quem falou
 *   QUANDO; sem trechos, não há a quem atribuir.
 */
export async function sessaoQueAceita(
  tx: Tx,
  id: string,
  completa: boolean,
): Promise<{ readonly sessao: Sessao } | Recusa> {
  // Sob RLS, sessão de outro profissional simplesmente não é encontrada.
  const [sessao] = await tx.select().from(sessions).where(eq(sessions.id, id)).limit(1);

  if (sessao === undefined) return { status: 404, error: "sessão não encontrada" };
  if (sessao.audioPath === null)
    return { status: 409, error: "esta consulta não tem áudio" };
  if (sessao.audioDeletedAt !== null) {
    return {
      status: 409,
      error: "o áudio desta consulta já foi apagado pela política de retenção",
    };
  }
  if (sessao.status === "approved") {
    return {
      status: 409,
      error:
        "a nota desta consulta já foi aprovada — quem falou não muda depois da assinatura",
    };
  }
  if (!completa) return { sessao };

  if (EM_PROCESSAMENTO.includes(sessao.status)) {
    return { status: 409, error: "espere a transcrição terminar" };
  }

  const [trechos] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.sessionId, sessao.id));
  if ((trechos?.n ?? 0) === 0) {
    return { status: 409, error: "a consulta ainda não tem transcrição" };
  }

  const [ocupado] = await tx
    .select({ kind: jobs.kind })
    .from(jobs)
    .where(
      and(
        eq(jobs.sessionId, sessao.id),
        inArray(jobs.kind, ["diarize_channels", "generate_note", "generate_objective"]),
        inArray(jobs.status, ["pending", "running"]),
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
    };
  }

  return { sessao };
}

/**
 * Aponta a sessão para o arquivo novo, registra o pedido e põe o job na fila.
 *
 * Devolve também o arquivo ANTERIOR, quando ele tinha outra chave — a medida
 * do envio passado, ou um original que não chegou a ser medido. Quem chamou o
 * apaga depois de a transação confirmar (ver `apagarAnterior`): sem isso ele
 * ficaria no disco sem nenhuma coluna apontando para ele, e nenhuma rotina de
 * exclusão o encontraria. Apagar antes do commit arriscaria o contrário — o
 * banco desfazer a troca e continuar apontando para um arquivo que já foi.
 */
export async function enfileirarSegundoMicrofone(
  tx: Tx,
  me: Professional,
  sessao: Sessao,
  chave: string,
  segundoPerto: LadoDoSegundo,
  duracaoS: number,
  medidoNoServidor: boolean,
): Promise<{
  readonly pedido: EstadoDoSegundoMicrofone;
  readonly anterior: string | null;
}> {
  const pedido: EstadoDoSegundoMicrofone = {
    estado: "na_fila",
    segundoPerto,
    enviadoEm: new Date().toISOString(),
    duracaoS: Math.round(duracaoS),
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
    metadados: { segundoPerto, duracaoS: pedido.duracaoS, medidoNoServidor },
  });

  const anterior =
    sessao.secondChannelPath !== null && sessao.secondChannelPath !== chave
      ? sessao.secondChannelPath
      : null;
  return { pedido, anterior };
}

/** Depois do commit: o arquivo que a sessão deixou de apontar. */
export async function apagarAnterior(anterior: string | null): Promise<void> {
  if (anterior !== null) await storage.remove(anterior).catch(() => undefined);
}
