/**
 * A transcrição de uma consulta, em etapas — as mesmas para a estação (o
 * worker) e para o ajudante no computador da pessoa. O ajudante não fala com
 * o banco: o site chama estas etapas por ele. Ver ADR-0005.
 *
 *   preparar → [juntar o áudio] → guardar a cópia → conferir a quota
 *     → [transcrever, no motor] → gravar
 *
 * As etapas entre colchetes são de quem processa: precisam dos bytes do
 * áudio e do motor. As outras falam com o banco e moram aqui — num lugar só,
 * para a estação e o ajudante nunca decidirem diferente sobre a mesma
 * consulta.
 */

import {
  canProcess,
  identifyRolesByContent,
  montarVocabulario,
  refineRolesByVoice,
  resolveEngine,
  roleByLabel,
  type Account,
  type EngineProgress,
  type TranscriptionResult,
} from "@scribe/core";
import { professionals, sessions, transcriptSegments, usageEvents } from "@scribe/db";
import {
  ehManifestoDePartes,
  LIMITE_ARQUIVO_UNICO_BYTES,
  sessionAudioKey,
  sessionPartKey,
  sessionPartsManifestKey,
  type AudioStorage,
} from "@scribe/storage";
import { eq } from "drizzle-orm";

import type { Executor } from "./fila";
import type { Guarda } from "./guarda";
import { lerManifesto, MANIFESTO_ILEGIVEL } from "./pedacos";

/** O suficiente de um logger: o pino do worker serve, e o site passa o seu. */
export interface Registro {
  info(dados: object, mensagem: string): void;
  warn(dados: object, mensagem: string): void;
  error(dados: object, mensagem: string): void;
}

export type Sessao = typeof sessions.$inferSelect & { readonly audioPath: string };
export type Dono = typeof professionals.$inferSelect;

/** De onde vem o áudio a transcrever. */
export type Fonte =
  | {
      readonly tipo: "arquivo";
      readonly chave: string;
      readonly nome: string;
      /** Apagar no fim, com a transcrição salva. */
      readonly apagarNoFim: readonly string[];
    }
  | {
      readonly tipo: "pedacos";
      /** As chaves, em ordem. */
      readonly pedacos: readonly string[];
      readonly nome: string;
      /**
       * Retomada: o arquivo final já foi guardado por uma tentativa que caiu
       * depois. Faltando pedaço, transcreve-se ele.
       */
      readonly reserva: string | null;
      readonly apagarNoFim: readonly string[];
    };

export type Preparo =
  | {
      readonly ok: true;
      readonly sessao: Sessao;
      readonly dono: Dono;
      readonly fonte: Fonte;
      readonly guarda: Guarda | null;
      /** O arquivo da sessão é o manifesto dos pedaços (e não um áudio). */
      readonly emPedacos: boolean;
    }
  | { readonly ok: false; readonly motivo: string };

/** Marca a sessão como falha, com o motivo que a tela mostra. */
export async function marcarFalha(
  db: Executor,
  sessionId: string,
  motivo: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({
      status: "failed",
      failureReason: motivo,
      progressPercent: null,
      progressPhase: null,
      progressEtaSeconds: null,
      progressPreview: null,
    })
    .where(eq(sessions.id, sessionId));
}

/**
 * Lê a sessão e o dono, e decide de onde vem o áudio e o que guardar.
 *
 * Os pedaços só saem no FIM, com a transcrição salva (`apagarNoFim`). Se uma
 * tentativa cair no meio — o computador desligado, o motor reiniciado —, a
 * próxima encontra o manifesto (retomada) e transcreve de novo o áudio
 * inteiro, sem perdas, e não a cópia comprimida já guardada.
 */
export async function prepararTranscricao(
  db: Executor,
  storage: Pick<AudioStorage, "get" | "exists">,
  sessionId: string,
  log: Registro,
): Promise<Preparo> {
  const [encontrada] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (encontrada === undefined) throw new Error(`sessão ${sessionId} não encontrada`);
  if (encontrada.audioPath === null) throw new Error("sessão sem áudio");
  const sessao: Sessao = { ...encontrada, audioPath: encontrada.audioPath };

  const [dono] = await db
    .select()
    .from(professionals)
    .where(eq(professionals.id, sessao.professionalId))
    .limit(1);
  if (dono === undefined) {
    throw new Error(`profissional ${sessao.professionalId} não encontrado`);
  }

  const manifesto = sessionPartsManifestKey(sessao.professionalId, sessao.id);
  const emPedacos = ehManifestoDePartes(sessao.audioPath);
  const retomada = !emPedacos && (await storage.exists(manifesto));

  let fonte: Fonte;
  if (emPedacos || retomada) {
    const lido = lerManifesto(await storage.get(manifesto));
    if (lido !== null) {
      const pedacos = Array.from({ length: lido.partes }, (_, i) =>
        sessionPartKey(sessao.professionalId, sessao.id, i),
      );
      fonte = {
        tipo: "pedacos",
        pedacos,
        nome: `consulta.${lido.extensao}`,
        reserva: retomada ? sessao.audioPath : null,
        apagarNoFim: [manifesto, ...pedacos],
      };
    } else if (retomada) {
      log.warn(
        { motivo: MANIFESTO_ILEGIVEL },
        "retomada sem os pedaços — usando o guardado",
      );
      fonte = {
        tipo: "arquivo",
        chave: sessao.audioPath,
        nome: sessao.audioPath,
        apagarNoFim: [manifesto],
      };
    } else {
      await marcarFalha(db, sessionId, MANIFESTO_ILEGIVEL);
      log.error({ motivo: MANIFESTO_ILEGIVEL }, "consulta em pedaços incompleta");
      return { ok: false, motivo: MANIFESTO_ILEGIVEL };
    }
  } else {
    fonte = {
      tipo: "arquivo",
      chave: sessao.audioPath,
      nome: sessao.audioPath,
      apagarNoFim: [],
    };
  }

  const precisaGuardar = emPedacos || (!retomada && sessao.speechRegions === null);
  const guarda: Guarda | null = precisaGuardar
    ? {
        wavDoNavegador: sessao.speechRegions !== null && fonte.nome.endsWith(".wav"),
        limiteBytes: LIMITE_ARQUIVO_UNICO_BYTES,
        chaveWav: sessionAudioKey(sessao.professionalId, sessao.id, "wav"),
        chaveM4a: sessionAudioKey(sessao.professionalId, sessao.id, "m4a"),
        obrigatoria: emPedacos,
      }
    : null;

  return { ok: true, sessao, dono, fonte, guarda, emPedacos };
}

/**
 * Faltou um pedaço ao juntar. Na retomada segue com o arquivo já guardado
 * (devolve a nova fonte); fora dela, a consulta está incompleta e a sessão
 * falha (devolve `null`).
 */
export async function pedacoFaltando(
  db: Executor,
  sessionId: string,
  fonte: Extract<Fonte, { tipo: "pedacos" }>,
  motivo: string,
  log: Registro,
): Promise<Extract<Fonte, { tipo: "arquivo" }> | null> {
  if (fonte.reserva !== null) {
    log.warn({ motivo }, "retomada sem os pedaços — usando o guardado");
    return {
      tipo: "arquivo",
      chave: fonte.reserva,
      nome: fonte.reserva,
      // Só o manifesto: era o que a estação já fazia neste caso.
      apagarNoFim: fonte.apagarNoFim.slice(0, 1),
    };
  }
  await marcarFalha(db, sessionId, motivo);
  log.error({ motivo }, "consulta em pedaços incompleta");
  return null;
}

/**
 * O motor recusou o arquivo ao converter: 415 (não é áudio legível) ou 413
 * (longo demais para guardar). Tentar de novo daria o mesmo resultado; a
 * sessão falha, com o que a pessoa pode fazer.
 */
export async function recusarAudio(
  db: Executor,
  sessionId: string,
  status: 413 | 415,
  motivo: string,
  log: Registro,
): Promise<void> {
  await marcarFalha(
    db,
    sessionId,
    status === 413
      ? `A gravação é longa demais para guardar (${motivo}). ` +
          `Divida o arquivo em partes menores e envie cada uma.`
      : `O arquivo enviado não pôde ser lido como áudio (${motivo}). ` +
          `Confira se é mesmo a gravação da consulta.`,
  );
  log.warn({ motivo, status }, "áudio recusado na conversão");
}

/**
 * A cópia já está gravada no armazenamento: a sessão passa a apontar para
 * ela. Devolve a sessão atualizada e o original avulso a apagar JÁ — os
 * pedaços esperam o fim da transcrição.
 */
export async function registrarGuarda(
  db: Executor,
  sessao: Sessao,
  emPedacos: boolean,
  guardado: {
    readonly chave: string;
    readonly extensao: string;
    readonly duracaoMs: number | null;
  },
): Promise<{ readonly sessao: Sessao; readonly apagarJa: string | null }> {
  const semMapa = sessao.speechRegions === null;
  const duracaoMs = semMapa
    ? (guardado.duracaoMs ?? sessao.durationMs)
    : sessao.durationMs;
  const regioes =
    semMapa && duracaoMs !== null
      ? [{ startMs: 0, endMs: duracaoMs }]
      : sessao.speechRegions;
  const silencio = semMapa ? 0 : sessao.silenceRemovedMs;

  await db
    .update(sessions)
    .set({
      audioPath: guardado.chave,
      durationMs: duracaoMs,
      silenceRemovedMs: silencio,
      speechRegions: regioes,
    })
    .where(eq(sessions.id, sessao.id));

  return {
    sessao: {
      ...sessao,
      audioPath: guardado.chave,
      durationMs: duracaoMs,
      silenceRemovedMs: silencio,
      speechRegions: regioes,
    },
    // Um original avulso sai já, depois de o arquivo final estar gravado e
    // apontado. Os pedaços esperam o fim da transcrição.
    apagarJa:
      !emPedacos && guardado.chave !== sessao.audioPath ? sessao.audioPath : null,
  };
}

/**
 * Motor, quota e início — antes de gastar.
 *
 * `motor` é o pedido para esta sessão, com a permissão de quem é dono (só o
 * `developer` escolhe). A quota é conferida sobre a duração já conhecida; sem
 * quota, a sessão falha com o motivo e o job termina.
 */
export async function iniciarTranscricao(
  db: Executor,
  sessao: Sessao,
  dono: Dono,
  log: Registro,
): Promise<
  | { readonly ok: true; readonly motor: ReturnType<typeof resolveEngine>["engine"] }
  | { readonly ok: false; readonly motivo: string }
> {
  const account: Account = {
    role: dono.role,
    plan: dono.plan,
    preferredEngine: dono.preferredEngine,
  };

  const decisao = resolveEngine(account, sessao.engineChoice);
  if (decisao.ignoredChoice !== null) {
    // Ou é bug de interface oferecendo uma opção que não existe, ou é
    // alguém no plano grátis tentando usar o motor que custa dinheiro.
    // Nos dois casos, alguém precisa ver.
    log.warn(
      { requested: decisao.ignoredChoice, used: decisao.engine },
      "escolha de motor descartada por falta de permissão",
    );
  }

  const minutos = (sessao.durationMs ?? 0) / 60_000;
  const permissao = canProcess(account, 0, minutos);
  if (!permissao.allowed) {
    await marcarFalha(db, sessao.id, permissao.reason);
    log.warn({ reason: permissao.reason }, "sessão bloqueada por quota");
    return { ok: false, motivo: permissao.reason };
  }

  await db
    .update(sessions)
    .set({ status: "transcribing" })
    .where(eq(sessions.id, sessao.id));
  return { ok: true, motor: decisao.engine };
}

/**
 * O que o motor recebe além do áudio.
 *
 * A voz cadastrada (camada A) compara trecho a trecho, o que o conteúdo não
 * alcança; sem cadastro, segue sem ela — é adição, não dependência. O
 * vocabulário da especialidade é desligável por configuração: é uma camada
 * que inclina o modelo, e uma inclinação que se prove prejudicial precisa
 * poder ser removida sem mexer em código.
 */
export function parametrosDoMotor(
  sessao: Sessao,
  dono: Dono,
  vocabularioLigado: boolean,
): {
  readonly impressaoVocal: readonly number[] | null;
  readonly vocabulario: string | null;
  readonly duracaoMs: number | null;
} {
  return {
    impressaoVocal: dono.voiceEmbedding,
    vocabulario: vocabularioLigado
      ? montarVocabulario({ especialidade: dono.specialty }).texto
      : null,
    duracaoMs: sessao.durationMs,
  };
}

/** O andamento do motor, para a tela de espera. */
export async function gravarAndamento(
  db: Executor,
  sessionId: string,
  p: Pick<EngineProgress, "percent" | "phaseLabel" | "etaSeconds" | "preview">,
): Promise<void> {
  await db
    .update(sessions)
    .set({
      progressPercent: p.percent,
      progressPhase: p.phaseLabel,
      progressEtaSeconds: p.etaSeconds,
      progressPreview: p.preview,
    })
    .where(eq(sessions.id, sessionId));
}

/**
 * Grava o que o motor devolveu: trechos, papéis, uso e o estado da sessão.
 *
 * `origem` vai para o registro de uso — "local:large-v3" na estação,
 * "ajudante:large-v3" no computador da pessoa.
 */
export async function gravarTranscricao(
  db: Executor,
  sessao: Sessao,
  resultado: TranscriptionResult,
  origem: string,
  log: Registro,
): Promise<{ readonly truncada: boolean }> {
  const sessionId = sessao.id;

  // Reprocessar precisa ser seguro: apagar antes de inserir evita transcrição
  // duplicada quando um job é repetido depois de falhar no meio.
  await db
    .delete(transcriptSegments)
    .where(eq(transcriptSegments.sessionId, sessionId));

  // ---- identificação de papel (Marco 3) ------------------------------
  // Roda sobre o conteúdo, não sobre a acústica. Medido no áudio real: o
  // pyannote erra as fronteiras, mas quem diz "vou solicitar exames" é o
  // profissional independentemente do rótulo que recebeu.
  const porConteudo = identifyRolesByContent(resultado.segments);

  // A voz entra POR CIMA do conteúdo, nunca no lugar dele. As duas
  // respondem perguntas diferentes: conteúdo diz qual grupo conduz a
  // consulta, voz diz se esta fala é dele. Quando concordam, a confiança
  // sobe; quando brigam, a voz vence e a briga é sinalizada.
  const refino = resultado.voiceMatchingApplied
    ? refineRolesByVoice(porConteudo, resultado.segments)
    : { assignments: porConteudo, correctedIndexes: [], disagreed: false };

  const papeis = refino.assignments;
  const porRotulo = roleByLabel(papeis);
  const decisao = papeis.find((p) => p.role === "professional");

  if (refino.disagreed) {
    log.warn({}, "voz cadastrada discordou do conteúdo sobre quem é o profissional");
  }

  log.info(
    {
      professional: decisao?.speakerLabel ?? null,
      confidence: decisao?.confidence ?? 0,
      voiceMatching: resultado.voiceMatchingApplied,
      voiceCorrections: refino.correctedIndexes.length,
      // Os SINAIS, não os trechos: "chama de doutor" pode ir para o log,
      // o que o paciente disse não.
      signals: decisao?.evidence.map((e) => e.signal) ?? [],
    },
    decisao === undefined
      ? "papel não identificado — revisão manual necessária"
      : "papel identificado",
  );

  if (resultado.segments.length > 0) {
    const corrigidos = new Set(refino.correctedIndexes);
    await db.insert(transcriptSegments).values(
      resultado.segments.map((s, i) => ({
        sessionId,
        professionalId: sessao.professionalId,
        speakerLabel: s.speakerLabel,
        // Trecho que a voz corrigiu recebe o papel oposto ao do seu rótulo:
        // é o caso em que a diarização pôs a fala na pessoa errada e só a
        // impressão vocal percebeu.
        role: corrigidos.has(i)
          ? porRotulo[s.speakerLabel] === "professional"
            ? ("patient" as const)
            : ("professional" as const)
          : (porRotulo[s.speakerLabel] ?? ("unknown" as const)),
        roleSource: corrigidos.has(i) ? ("voice_match" as const) : ("llm" as const),
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        confidence: s.confidence,
      })),
    );
  }

  // ---- trava de integridade ------------------------------------------
  // Os trechos ficam salvos — são reais e servem para diagnóstico. Mas a
  // sessão NÃO pode chegar ao profissional como "pronta para revisão": o
  // que falta no fim de uma consulta costuma ser a conduta, e uma nota
  // gerada sobre transcrição cortada omitiria a prescrição sem avisar
  // ninguém. Falhar alto é o único comportamento aceitável aqui.
  if (resultado.truncated) {
    const segundos = Math.round(resultado.uncoveredMs / 1000);
    await db
      .update(sessions)
      .set({
        status: "failed",
        failureReason:
          `Transcrição incompleta: os últimos ${segundos}s do áudio não foram ` +
          `transcritos. A gravação está preservada: reprocesse antes de usar.`,
        engineUsed: resultado.engine,
        durationMs: resultado.durationMs,
        progressPercent: null,
        progressPhase: null,
        progressEtaSeconds: null,
        progressPreview: null,
      })
      .where(eq(sessions.id, sessionId));
    log.error(
      { uncoveredMs: resultado.uncoveredMs, durationMs: resultado.durationMs },
      "transcrição truncada — sessão marcada como falha",
    );
    return { truncada: true };
  }

  await db.insert(usageEvents).values({
    professionalId: sessao.professionalId,
    sessionId,
    kind: "asr",
    minutes: resultado.durationMs / 60_000,
    // O motor local não tem custo por minuto: o custo dele é o computador,
    // que é fixo — o da estação, ou o da própria pessoa. Zero aqui é o dado
    // correto, e é o que vai fazer a diferença de margem entre os planos
    // aparecer no relatório quando o motor de nuvem entrar com o preço real
    // por minuto.
    costCents: 0,
    provider: `${origem}:${resultado.model}`,
  });

  await db
    .update(sessions)
    .set({
      status: "ready_for_review",
      engineUsed: resultado.engine,
      durationMs: resultado.durationMs,
      failureReason: null,
      roleAssignment: papeis,
      progressPercent: null,
      progressPhase: null,
      progressEtaSeconds: null,
      progressPreview: null,
    })
    .where(eq(sessions.id, sessionId));

  return { truncada: false };
}
