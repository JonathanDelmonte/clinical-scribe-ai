/**
 * Handler de transcrição — o job que atravessa o sistema inteiro.
 *
 *   sessão no banco → busca o áudio → guarda a cópia → quota → transcreve
 *   → grava os trechos → marca a sessão revisável
 *
 * As etapas que falam com o banco moram em `@scribe/processamento`, e são as
 * MESMAS que o site conduz em nome do ajudante, no computador de cada pessoa
 * (ADR-0005). Aqui fica só o que é da estação: ler o áudio do armazenamento e
 * falar com o motor do Docker.
 *
 * Roda com a conexão de serviço, que ignora RLS. Isso é necessário (o worker
 * não tem usuário autenticado) e é justamente por isso que cada consulta lá
 * filtra por sessão e profissional explicitamente: sem a rede de proteção do
 * banco, a disciplina precisa estar no código.
 */

import { type Database } from "@scribe/db";
import { converterParaM4a, type Convertido } from "@scribe/motor";
import {
  formatoParaGuardar,
  gravarAndamento,
  gravarTranscricao,
  iniciarTranscricao,
  lerPedacos,
  parametrosDoMotor,
  pedacoFaltando,
  prepararTranscricao,
  recusarAudio,
  registrarGuarda,
  type ClaimedJob,
  type Fonte,
} from "@scribe/processamento";
import { type AudioStorage } from "@scribe/storage";

import type { Logger } from "pino";
import { config } from "../config.js";
import { getAvailableProvider } from "../providers/index.js";

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

    const preparo = await prepararTranscricao(db, storage, sessionId, log);
    if (!preparo.ok) return;
    const { dono, guarda, emPedacos } = preparo;
    let { sessao } = preparo;
    let fonte: Fonte = preparo.fonte;

    // ---- montagem ---------------------------------------------------------
    let audio: Uint8Array<ArrayBuffer>;
    if (fonte.tipo === "pedacos") {
      const lidos = await lerPedacos(storage, fonte.pedacos);
      if (lidos.ok) {
        audio = lidos.bytes;
      } else {
        const reserva = await pedacoFaltando(db, sessionId, fonte, lidos.motivo, log);
        if (reserva === null) return;
        fonte = reserva;
        audio = await storage.get(fonte.chave);
      }
    } else {
      audio = await storage.get(fonte.chave);
    }

    // ---- a cópia que fica guardada ------------------------------------------
    if (guarda !== null) {
      let guardar: {
        bytes: Uint8Array<ArrayBuffer>;
        extensao: "wav" | "m4a";
        duracaoMs: number | null;
      } | null = null;
      if (formatoParaGuardar(guarda, audio.byteLength) === "wav") {
        guardar = { bytes: audio, extensao: "wav", duracaoMs: null };
      } else {
        let convertido: Convertido | null = null;
        try {
          convertido = await converterParaM4a(
            config.ASR_LOCAL_URL,
            audio,
            fonte.nome,
            guarda.limiteBytes,
          );
        } catch (erro) {
          log.warn({ err: erro }, "conversão indisponível — motor fora do ar?");
        }
        if (convertido !== null && !convertido.ok) {
          await recusarAudio(db, sessionId, convertido.status, convertido.motivo, log);
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

      if (guardar === null && guarda.obrigatoria) {
        // Em pedaços e sem motor para comprimir: não há arquivo final para
        // guardar ainda. A fila tenta de novo — os pedaços continuam sendo a
        // consulta até lá.
        throw new Error(
          "Motor indisponível para juntar a consulta. Nova tentativa em breve.",
        );
      }

      if (guardar !== null) {
        const chave = guardar.extensao === "wav" ? guarda.chaveWav : guarda.chaveM4a;
        await storage.put(chave, guardar.bytes);
        const registrado = await registrarGuarda(db, sessao, emPedacos, {
          chave,
          extensao: guardar.extensao,
          duracaoMs: guardar.duracaoMs,
        });
        sessao = registrado.sessao;
        if (registrado.apagarJa !== null) {
          await storage.remove(registrado.apagarJa).catch((erro: unknown) => {
            log.error({ err: erro }, "original não apagado depois de guardar o áudio");
          });
        }
        log.info(
          {
            de: emPedacos ? "pedaços" : fonte.nome.slice(fonte.nome.lastIndexOf(".")),
            guardado: guardar.extensao,
            megabytes: Math.round(guardar.bytes.byteLength / 1e5) / 10,
          },
          "áudio montado e guardado",
        );
      }
    }

    // ---- motor e quota, ANTES de gastar ----------------------------------
    const inicio = await iniciarTranscricao(db, sessao, dono, log);
    if (!inicio.ok) return;

    // ---- transcrição ------------------------------------------------------
    const { provider, fellBack } = await getAvailableProvider(inicio.motor);
    if (fellBack) {
      log.warn(
        { preferred: inicio.motor, using: provider.engine },
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
        await gravarAndamento(db, sessionId, p).catch(() => undefined);
      }
    })();

    const parametros = parametrosDoMotor(sessao, dono, config.ASR_VOCABULARY);
    let result;
    try {
      result = await provider.transcribe({
        audio,
        filename: fonte.nome,
        diarize: true,
        jobId: job.id,
        professionalEmbedding: parametros.impressaoVocal,
        vocabulary: parametros.vocabulario,
        durationMs: parametros.duracaoMs,
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
    const gravado = await gravarTranscricao(db, sessao, result, provider.engine, log);
    if (gravado.truncada) return;

    log.info({ elapsedMs: Date.now() - started }, "sessão pronta para revisão");

    // Só agora, com a transcrição salva: até aqui os pedaços eram o áudio
    // inteiro, sem perdas, para uma nova tentativa.
    for (const chave of fonte.apagarNoFim) {
      await storage.remove(chave).catch((erro: unknown) => {
        log.error({ err: erro }, "pedaço não apagado depois da transcrição");
      });
    }
  };
}
