/**
 * Handler de transcrição — o job que atravessa o sistema inteiro.
 *
 *   sessão no banco → decide o motor → busca o áudio → transcreve
 *   → grava os trechos → registra o uso → marca a sessão revisável
 *
 * Roda com a conexão de serviço, que ignora RLS. Isso é necessário (o worker
 * não tem usuário autenticado) e é justamente por isso que cada consulta aqui
 * filtra por `professionalId` explicitamente: sem a rede de proteção do banco,
 * a disciplina precisa estar no código.
 */

import {
  canProcess,
  identifyRolesByContent,
  montarVocabulario,
  refineRolesByVoice,
  resolveEngine,
  roleByLabel,
  type Account,
} from "@scribe/core";
import {
  professionals,
  sessions,
  transcriptSegments,
  usageEvents,
  type Database,
} from "@scribe/db";
import {
  ehManifestoDePartes,
  LIMITE_ARQUIVO_UNICO_BYTES,
  sessionAudioKey,
  sessionPartKey,
  sessionPartsManifestKey,
  type AudioStorage,
} from "@scribe/storage";
import { eq } from "drizzle-orm";

import type { Logger } from "pino";
import { config } from "../config.js";
import { getAvailableProvider } from "../providers/index.js";
import { juntarPedacos } from "../pedacos.js";
import { converterParaM4a, type Convertido } from "../providers/local.js";
import type { ClaimedJob } from "../queue.js";

export function makeTranscribeHandler(
  db: Database,
  storage: AudioStorage,
  logger: Logger,
) {
  return async function handleTranscribe(job: ClaimedJob): Promise<void> {
    const { sessionId } = job;
    if (sessionId === null) {
      throw new Error("job de transcrição sem sessionId");
    }

    const log = logger.child({ sessionId, jobId: job.id });

    const [encontrada] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (encontrada === undefined) {
      throw new Error(`sessão ${sessionId} não encontrada`);
    }
    if (encontrada.audioPath === null) {
      throw new Error("sessão sem áudio");
    }
    // `let`: a normalização abaixo pode trocar o arquivo da sessão.
    let session = { ...encontrada, audioPath: encontrada.audioPath };

    const [owner] = await db
      .select()
      .from(professionals)
      .where(eq(professionals.id, session.professionalId))
      .limit(1);

    if (owner === undefined) {
      throw new Error(`profissional ${session.professionalId} não encontrado`);
    }

    // ---- montagem e normalização ------------------------------------------
    //
    // `audio` é o que o motor vai transcrever — sempre o melhor que existe: o
    // áudio inteiro, sem perdas quando possível. O que fica GUARDADO pode ser
    // outra coisa, e é decidido logo abaixo.
    //
    // Três casos:
    //
    //   1. Em pedaços (manifesto): o site não junta mais — ver a rota de
    //      finalização. Os pedaços são juntados aqui, na memória.
    //   2. Sem mapa de regiões: o arquivo chegou como veio — AMR de gravador
    //      antigo, WMA, ALAC do iPhone — e a tela não conseguiria tocá-lo, e
    //      cada citação da nota depende de ouvir o trecho que a sustenta.
    //   3. O WAV que o navegador preparou, já guardado: nada a fazer.
    //
    // Nos casos 1 e 2 o arquivo guardado é trocado: o próprio áudio se ele é o
    // WAV do navegador e cabe num arquivo; senão, a cópia comprimida (M4A,
    // ~14 MB por hora), que qualquer navegador toca e que cabe nos 50 MB por
    // arquivo do Supabase gratuito mesmo com horas de consulta.
    //
    // Os pedaços só saem no FIM, com a transcrição salva (`pedacosParaApagar`).
    // Se esta tentativa cair no meio — o Docker desligado, o motor reiniciado
    // —, a próxima encontra o manifesto (`retomada`) e transcreve de novo o
    // áudio inteiro, sem perdas, e não a cópia comprimida já guardada.
    let audio: Uint8Array<ArrayBuffer>;
    let nomeDoAudio: string;
    let pedacosParaApagar: string[] = [];
    const manifesto = sessionPartsManifestKey(session.professionalId, session.id);
    const emPedacos = ehManifestoDePartes(session.audioPath);
    const retomada = !emPedacos && (await storage.exists(manifesto));
    if (emPedacos || retomada) {
      const juntado = await juntarPedacos(storage, manifesto, (i) =>
        sessionPartKey(session.professionalId, session.id, i),
      );
      if (juntado.ok) {
        audio = juntado.bytes;
        nomeDoAudio = `consulta.${juntado.manifesto.extensao}`;
        pedacosParaApagar = [
          manifesto,
          ...Array.from({ length: juntado.manifesto.partes }, (_, i) =>
            sessionPartKey(session.professionalId, session.id, i),
          ),
        ];
      } else if (retomada) {
        // Faltam pedaços, mas o arquivo final já está guardado: segue com ele.
        log.warn(
          { motivo: juntado.motivo },
          "retomada sem os pedaços — usando o guardado",
        );
        audio = await storage.get(session.audioPath);
        nomeDoAudio = session.audioPath;
        pedacosParaApagar = [manifesto];
      } else {
        await db
          .update(sessions)
          .set({ status: "failed", failureReason: juntado.motivo })
          .where(eq(sessions.id, sessionId));
        log.error({ motivo: juntado.motivo }, "consulta em pedaços incompleta");
        return;
      }
    } else {
      audio = await storage.get(session.audioPath);
      nomeDoAudio = session.audioPath;
    }

    if (emPedacos || (!retomada && session.speechRegions === null)) {
      const preparadoPeloNavegador =
        session.speechRegions !== null && nomeDoAudio.endsWith(".wav");

      let guardar: {
        bytes: Uint8Array<ArrayBuffer>;
        extensao: string;
        duracaoMs: number | null;
      } | null = null;
      if (preparadoPeloNavegador && audio.byteLength <= LIMITE_ARQUIVO_UNICO_BYTES) {
        guardar = { bytes: audio, extensao: "wav", duracaoMs: null };
      } else {
        let convertido: Convertido | null = null;
        try {
          convertido = await converterParaM4a(
            config.ASR_LOCAL_URL,
            audio,
            nomeDoAudio,
            LIMITE_ARQUIVO_UNICO_BYTES,
          );
        } catch (erro) {
          log.warn({ err: erro }, "conversão indisponível — motor fora do ar?");
        }
        if (convertido !== null && !convertido.ok) {
          await db
            .update(sessions)
            .set({
              status: "failed",
              failureReason:
                convertido.status === 413
                  ? `A gravação é longa demais para guardar (${convertido.motivo}). ` +
                    `Divida o arquivo em partes menores e envie cada uma.`
                  : `O arquivo enviado não pôde ser lido como áudio (${convertido.motivo}). ` +
                    `Confira se é mesmo a gravação da consulta.`,
            })
            .where(eq(sessions.id, sessionId));
          log.warn(
            { motivo: convertido.motivo, status: convertido.status },
            "áudio recusado na conversão",
          );
          return;
        }
        if (convertido !== null) {
          guardar = {
            bytes: convertido.bytes,
            extensao: "m4a",
            duracaoMs: convertido.duracaoMs,
          };
        }
      }

      if (guardar === null && emPedacos) {
        // Em pedaços e sem motor para comprimir: não há arquivo final para
        // guardar ainda. A fila tenta de novo — os pedaços continuam sendo a
        // consulta até lá.
        throw new Error(
          "motor indisponível para juntar a consulta — nova tentativa em breve",
        );
      }

      if (guardar !== null) {
        const chave = sessionAudioKey(
          session.professionalId,
          session.id,
          guardar.extensao,
        );
        const semMapa = session.speechRegions === null;
        const duracaoMs = semMapa
          ? (guardar.duracaoMs ?? session.durationMs)
          : session.durationMs;
        const regioes =
          semMapa && duracaoMs !== null
            ? [{ startMs: 0, endMs: duracaoMs }]
            : session.speechRegions;
        const silencio = semMapa ? 0 : session.silenceRemovedMs;

        await storage.put(chave, guardar.bytes);
        await db
          .update(sessions)
          .set({
            audioPath: chave,
            durationMs: duracaoMs,
            silenceRemovedMs: silencio,
            speechRegions: regioes,
          })
          .where(eq(sessions.id, sessionId));

        // Um original avulso (sem pedaços) sai já, depois de o arquivo final
        // estar gravado e apontado. Os pedaços esperam o fim da transcrição.
        if (!emPedacos && chave !== session.audioPath) {
          await storage.remove(session.audioPath).catch((erro: unknown) => {
            log.error({ err: erro }, "original não apagado depois de guardar o áudio");
          });
        }
        log.info(
          {
            de: emPedacos ? "pedaços" : nomeDoAudio.slice(nomeDoAudio.lastIndexOf(".")),
            guardado: guardar.extensao,
            megabytes: Math.round(guardar.bytes.byteLength / 1e5) / 10,
          },
          "áudio montado e guardado",
        );
        session = {
          ...session,
          audioPath: chave,
          durationMs: duracaoMs,
          silenceRemovedMs: silencio,
          speechRegions: regioes,
        };
      }
    }

    const account: Account = {
      role: owner.role,
      plan: owner.plan,
      preferredEngine: owner.preferredEngine,
    };

    // ---- decisão de motor -----------------------------------------------
    const decision = resolveEngine(account, session.engineChoice);

    if (decision.ignoredChoice !== null) {
      // Ou é bug de interface oferecendo uma opção que não existe, ou é
      // alguém no plano grátis tentando usar o motor que custa dinheiro.
      // Nos dois casos, alguém precisa ver.
      log.warn(
        { requested: decision.ignoredChoice, used: decision.engine },
        "escolha de motor descartada por falta de permissão",
      );
    }

    // ---- quota, ANTES de gastar ------------------------------------------
    const sessionMinutes = (session.durationMs ?? 0) / 60_000;
    const allowance = canProcess(account, 0, sessionMinutes);
    if (!allowance.allowed) {
      await db
        .update(sessions)
        .set({ status: "failed", failureReason: allowance.reason })
        .where(eq(sessions.id, sessionId));
      log.warn({ reason: allowance.reason }, "sessão bloqueada por quota");
      return;
    }

    await db
      .update(sessions)
      .set({ status: "transcribing" })
      .where(eq(sessions.id, sessionId));

    // ---- transcrição ------------------------------------------------------
    const { provider, fellBack } = await getAvailableProvider(decision.engine);
    if (fellBack) {
      log.warn(
        { preferred: decision.engine, using: provider.engine },
        "motor preferido indisponível, usando o local",
      );
    }

    const started = Date.now();

    // Acompanhamento em paralelo com a transcrição.
    //
    // O motor sabe até que segundo do áudio já chegou; este laço traz esse
    // número para o banco, de onde a interface o lê. Sem isso a tela mostraria
    // só um indicador girando, que não distingue "faltam dez segundos" de
    // "travou há dez minutos" — e foi exatamente essa dúvida que motivou a
    // existência disto.
    let acompanhando = true;
    const acompanhamento = (async () => {
      while (acompanhando) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!acompanhando) break;
        const p = await provider.progress?.(job.id);
        if (p === null || p === undefined) continue;
        await db
          .update(sessions)
          .set({
            progressPercent: p.percent,
            progressPhase: p.phaseLabel,
            progressEtaSeconds: p.etaSeconds,
            progressPreview: p.preview,
          })
          .where(eq(sessions.id, sessionId))
          .catch(() => undefined);
      }
    })();

    // Termos da especialidade de quem atende, para a grafia sair certa.
    // Desligável por configuração: é uma camada que inclina o modelo, e uma
    // inclinação que se prove prejudicial precisa poder ser removida sem
    // mexer em código — ver ASR_VOCABULARY em config.ts.
    const vocabulario = config.ASR_VOCABULARY
      ? montarVocabulario({ especialidade: owner.specialty })
      : null;

    let result;
    try {
      result = await provider.transcribe({
        audio,
        filename: nomeDoAudio,
        diarize: true,
        jobId: job.id,
        // Camada A, quando houver: a voz cadastrada compara trecho a trecho, o
        // que o conteúdo não alcança. Sem cadastro, segue sem ela — é adição,
        // não dependência.
        professionalEmbedding: owner.voiceEmbedding,
        vocabulary: vocabulario?.texto ?? null,
        durationMs: session.durationMs,
      });
    } finally {
      // Encerra o laço ANTES de qualquer outra escrita na sessão: um
      // acompanhamento ainda vivo sobrescreveria o estado final com um
      // progresso velho.
      acompanhando = false;
      await acompanhamento;
    }

    log.info(
      {
        engine: provider.engine,
        model: result.model,
        segments: result.segments.length,
        speakers: result.speakers.length,
        realtimeFactor: result.realtimeFactor,
        diarization: result.diarizationApplied,
      },
      "transcrição concluída",
    );

    // ---- persistência -----------------------------------------------------
    // Reprocessar precisa ser seguro: apagar antes de inserir evita transcrição
    // duplicada quando um job é repetido depois de falhar no meio.
    await db
      .delete(transcriptSegments)
      .where(eq(transcriptSegments.sessionId, sessionId));

    // ---- identificação de papel (Marco 3) ------------------------------
    // Roda sobre o conteúdo, não sobre a acústica. Medido no áudio real: o
    // pyannote erra as fronteiras, mas quem diz "vou solicitar exames" é o
    // profissional independentemente do rótulo que recebeu.
    const porConteudo = identifyRolesByContent(result.segments);

    // A voz entra POR CIMA do conteúdo, nunca no lugar dele. As duas
    // respondem perguntas diferentes: conteúdo diz qual grupo conduz a
    // consulta, voz diz se esta fala é dele. Quando concordam, a confiança
    // sobe; quando brigam, a voz vence e a briga é sinalizada.
    const refino = result.voiceMatchingApplied
      ? refineRolesByVoice(porConteudo, result.segments)
      : { assignments: porConteudo, correctedIndexes: [], disagreed: false };

    const papeis = refino.assignments;
    const porRotulo = roleByLabel(papeis);
    const decisao = papeis.find((p) => p.role === "professional");

    if (refino.disagreed) {
      log.warn("voz cadastrada discordou do conteúdo sobre quem é o profissional");
    }

    log.info(
      {
        professional: decisao?.speakerLabel ?? null,
        confidence: decisao?.confidence ?? 0,
        voiceMatching: result.voiceMatchingApplied,
        voiceCorrections: refino.correctedIndexes.length,
        // Os SINAIS, não os trechos: "chama de doutor" pode ir para o log,
        // o que o paciente disse não.
        signals: decisao?.evidence.map((e) => e.signal) ?? [],
      },
      decisao === undefined
        ? "papel não identificado — revisão manual necessária"
        : "papel identificado",
    );

    if (result.segments.length > 0) {
      const corrigidos = new Set(refino.correctedIndexes);
      await db.insert(transcriptSegments).values(
        result.segments.map((s, i) => ({
          sessionId,
          professionalId: session.professionalId,
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
    if (result.truncated) {
      const seconds = Math.round(result.uncoveredMs / 1000);
      const reason =
        `Transcrição incompleta: os últimos ${seconds}s do áudio não foram ` +
        `transcritos. A gravação está preservada — reprocesse antes de usar.`;

      await db
        .update(sessions)
        .set({
          status: "failed",
          failureReason: reason,
          engineUsed: provider.engine,
          durationMs: result.durationMs,
          progressPercent: null,
          progressPhase: null,
          progressEtaSeconds: null,
          progressPreview: null,
        })
        .where(eq(sessions.id, sessionId));

      log.error(
        { uncoveredMs: result.uncoveredMs, durationMs: result.durationMs },
        "transcrição truncada — sessão marcada como falha",
      );
      return;
    }

    await db.insert(usageEvents).values({
      professionalId: session.professionalId,
      sessionId,
      kind: "asr",
      minutes: result.durationMs / 60_000,
      // O motor local não tem custo por minuto: o custo dele é o servidor,
      // que é fixo. Zero aqui é o dado correto, e é o que vai fazer a
      // diferença de margem entre os planos aparecer no relatório quando o
      // motor de nuvem entrar com o preço real por minuto.
      costCents: 0,
      provider: `${provider.engine}:${result.model}`,
    });

    await db
      .update(sessions)
      .set({
        status: "ready_for_review",
        engineUsed: provider.engine,
        durationMs: result.durationMs,
        failureReason: null,
        roleAssignment: papeis,
        progressPercent: null,
        progressPhase: null,
        progressEtaSeconds: null,
        progressPreview: null,
      })
      .where(eq(sessions.id, sessionId));

    log.info({ elapsedMs: Date.now() - started }, "sessão pronta para revisão");

    // Só agora, com a transcrição salva: até aqui os pedaços eram o áudio
    // inteiro, sem perdas, para uma nova tentativa.
    for (const chave of pedacosParaApagar) {
      await storage.remove(chave).catch((erro: unknown) => {
        log.error({ err: erro }, "pedaço não apagado depois da transcrição");
      });
    }
  };
}
