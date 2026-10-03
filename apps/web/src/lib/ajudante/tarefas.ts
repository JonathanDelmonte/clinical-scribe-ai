import "server-only";

import { jobs, type Database } from "@scribe/db";
import {
  claimJob,
  completeJob,
  ErroDefinitivo,
  failJob,
  faltaOPedaco,
  gravarAndamento,
  gravarImpressaoVocal,
  gravarTranscricao,
  iniciarTranscricao,
  lerPedidoDeVoz,
  lerResultado,
  parametrosDoMotor,
  pedacoFaltando,
  prepararTranscricao,
  recusarAudio,
  registrarGuarda,
  renewLease,
  TIPO_IMPRESSAO_VOCAL,
  VOZ_CURTA,
  type Andamento,
  type AvisoDeAudio,
  type ClaimedJob,
  type Entrega,
  type Falha,
  type OrdemDeServico,
  type Registro,
  type RespostaDoAudio,
} from "@scribe/processamento";
import { and, eq } from "drizzle-orm";

import { storage } from "../storage";
import { linkDoArquivo } from "./arquivos";
import { comoServico, type Ajudante } from "./conta";
import { registroDoAjudante } from "./registro";

/**
 * O site conduzindo, em nome do ajudante, as mesmas etapas que a estação
 * conduz sozinha (`@scribe/processamento`). O ajudante faz a parte pesada — o
 * áudio e o motor — e conta o que aconteceu; daqui, cada etapa é conferida e
 * gravada. Ver ADR-0005.
 *
 * Duas regras atravessam o arquivo:
 *
 * 1. **Toda operação confere o job**: é deste profissional, foi este ajudante
 *    que o pegou, e ainda está com ele (`jobDoAjudante`). Uma concessão vencida
 *    — o ajudante sumiu e a estação assumiu — devolve `TarefaPerdida`, e o
 *    ajudante larga o trabalho.
 * 2. **Arquivo só sai DEPOIS de a transação gravar.** Apagar dentro dela, e
 *    ela voltar atrás, deixaria a sessão apontando para um arquivo que não
 *    existe mais.
 */

/** O job não é mais deste ajudante (concessão vencida, sessão apagada). */
export class TarefaPerdida extends Error {
  override readonly name = "TarefaPerdida";
}

/** O que o ajudante mandou não serve — erro dele, não do site. */
export class EntregaInvalida extends Error {
  override readonly name = "EntregaInvalida";
}

async function jobDoAjudante(
  tx: Database,
  ajudante: Ajudante,
  jobId: string,
): Promise<ClaimedJob> {
  const [linha] = await tx
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.professionalId, ajudante.professionalId),
        eq(jobs.helperId, ajudante.id),
        eq(jobs.status, "running"),
      ),
    )
    .limit(1);
  if (linha === undefined)
    throw new TarefaPerdida("este trabalho não está mais com este computador");
  return {
    id: linha.id,
    kind: linha.kind,
    payload: linha.payload,
    sessionId: linha.sessionId,
    professionalId: linha.professionalId,
    attempts: linha.attempts,
    maxAttempts: linha.maxAttempts,
    helperId: linha.helperId,
  };
}

function sessaoDoJob(job: ClaimedJob): string {
  if (job.kind !== "transcribe" || job.sessionId === null) {
    throw new EntregaInvalida("este trabalho não é uma transcrição");
  }
  return job.sessionId;
}

async function apagarDepois(chaves: readonly string[], log: Registro): Promise<void> {
  for (const chave of chaves) {
    await storage.remove(chave).catch((erro: unknown) => {
      log.error({ err: erro }, "arquivo não apagado depois da etapa");
    });
  }
}

const vocabularioLigado = () => process.env["ASR_VOCABULARY"] === "true";

// -----------------------------------------------------------------------------
// Pegar
// -----------------------------------------------------------------------------

/**
 * O próximo trabalho deste ajudante, já como ordem de serviço — ou `null`.
 *
 * Um job pode terminar já na preparação (consulta incompleta, pedido
 * ilegível): esse é encerrado aqui mesmo, e o próximo vem no lugar.
 */
export async function pegarTarefa(
  ajudante: Ajudante,
  origem: string,
): Promise<OrdemDeServico | null> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const job = await comoServico((tx) =>
      claimJob(tx, {
        tipo: "ajudante",
        helperId: ajudante.id,
        professionalId: ajudante.professionalId,
      }),
    );
    if (job === null) return null;

    const log = registroDoAjudante({ ajudante: ajudante.id, jobId: job.id });
    try {
      const ordem = await comoServico((tx) =>
        montarOrdem(tx, job, ajudante, origem, log),
      );
      if (ordem !== null) return ordem;
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await comoServico((tx) =>
        failJob(tx, job, mensagem, erro instanceof ErroDefinitivo, ajudante.id),
      );
      log.error({ err: erro }, "ordem de serviço não montada");
      return null;
    }
  }
  return null;
}

async function montarOrdem(
  tx: Database,
  job: ClaimedJob,
  ajudante: Ajudante,
  origem: string,
  log: Registro,
): Promise<OrdemDeServico | null> {
  if (job.kind === TIPO_IMPRESSAO_VOCAL) {
    const pedido = lerPedidoDeVoz(job.payload, job.professionalId);
    if (pedido === null) throw new ErroDefinitivo("pedido de cadastro de voz ilegível");
    return {
      id: job.id,
      tipo: "voz",
      amostra: linkDoArquivo(origem, pedido.chave, "GET"),
      nome: pedido.nome,
    };
  }

  const sessionId = job.sessionId;
  if (job.kind !== "transcribe" || sessionId === null) {
    throw new ErroDefinitivo(`o ajudante não processa jobs do tipo "${job.kind}"`);
  }
  const preparo = await prepararTranscricao(tx, storage, sessionId, log);
  if (!preparo.ok) {
    // A sessão já foi marcada como falha, com o motivo; o job termina.
    await completeJob(tx, job.id, ajudante.id);
    return null;
  }
  const { sessao, dono, fonte, guarda } = preparo;
  if (sessao.professionalId !== ajudante.professionalId) {
    throw new ErroDefinitivo("a sessão é de outro profissional");
  }

  const parametros = parametrosDoMotor(sessao, dono, vocabularioLigado());
  return {
    id: job.id,
    tipo: "transcrever",
    sessao: sessao.id,
    audio: {
      nome: fonte.nome,
      partes:
        fonte.tipo === "pedacos"
          ? fonte.pedacos.map((chave) => linkDoArquivo(origem, chave, "GET"))
          : [linkDoArquivo(origem, fonte.chave, "GET")],
    },
    reserva:
      fonte.tipo === "pedacos" && fonte.reserva !== null
        ? { url: linkDoArquivo(origem, fonte.reserva, "GET"), nome: fonte.reserva }
        : null,
    guarda:
      guarda === null
        ? null
        : {
            wavDoNavegador: guarda.wavDoNavegador,
            limiteBytes: guarda.limiteBytes,
            envioWav: linkDoArquivo(origem, guarda.chaveWav, "PUT"),
            envioM4a: linkDoArquivo(origem, guarda.chaveM4a, "PUT"),
            obrigatoria: guarda.obrigatoria,
          },
    motor: {
      idioma: "pt",
      impressaoVocal: parametros.impressaoVocal,
      vocabulario: parametros.vocabulario,
      duracaoMs: parametros.duracaoMs,
    },
  };
}

// -----------------------------------------------------------------------------
// Andamento
// -----------------------------------------------------------------------------

/** Renova a concessão e, com o motor trabalhando, grava o andamento. */
export async function registrarAndamento(
  ajudante: Ajudante,
  jobId: string,
  andamento: Andamento,
): Promise<void> {
  await comoServico(async (tx) => {
    const job = await jobDoAjudante(tx, ajudante, jobId);
    await renewLease(tx, job.id, ajudante.id);
    if (andamento.percent !== undefined && job.sessionId !== null) {
      await gravarAndamento(tx, job.sessionId, {
        percent: andamento.percent,
        phaseLabel: andamento.fase ?? "",
        etaSeconds: andamento.etaS ?? null,
        preview: andamento.previa ?? null,
      });
    }
  });
}

// -----------------------------------------------------------------------------
// A cópia guardada, e o início
// -----------------------------------------------------------------------------

/**
 * O ajudante guardou a cópia (ou não havia o que guardar): a sessão passa a
 * apontar para ela, e a quota é conferida antes de o motor trabalhar.
 */
export async function avisarAudio(
  ajudante: Ajudante,
  jobId: string,
  aviso: AvisoDeAudio,
): Promise<RespostaDoAudio> {
  const log = registroDoAjudante({ ajudante: ajudante.id, jobId });
  const { resposta, apagar } = await comoServico(async (tx) => {
    const job = await jobDoAjudante(tx, ajudante, jobId);
    const preparo = await prepararTranscricao(tx, storage, sessaoDoJob(job), log);
    if (!preparo.ok) {
      await completeJob(tx, job.id, ajudante.id);
      return { resposta: { seguir: false }, apagar: [] };
    }

    let sessao = preparo.sessao;
    const apagar: string[] = [];
    if (aviso.guardado !== null) {
      if (preparo.guarda === null) {
        throw new EntregaInvalida("esta consulta não pedia uma cópia guardada");
      }
      const chave =
        aviso.guardado.formato === "wav"
          ? preparo.guarda.chaveWav
          : preparo.guarda.chaveM4a;
      // Não basta o ajudante dizer que enviou: a sessão só aponta para um
      // arquivo que o armazenamento confirma ter.
      if (!(await storage.exists(chave))) {
        throw new EntregaInvalida("a cópia da consulta não chegou ao armazenamento");
      }
      const registrado = await registrarGuarda(tx, sessao, preparo.emPedacos, {
        chave,
        extensao: aviso.guardado.formato,
        duracaoMs: aviso.guardado.duracaoMs,
      });
      sessao = registrado.sessao;
      if (registrado.apagarJa !== null) apagar.push(registrado.apagarJa);
    } else if (preparo.guarda?.obrigatoria === true && !aviso.usouReserva) {
      // Em pedaços, sem cópia não há arquivo final: o ajudante devia ter
      // contado a falha, e a fila tenta de novo.
      throw new EntregaInvalida("a consulta em pedaços precisa da cópia guardada");
    }

    const inicio = await iniciarTranscricao(tx, sessao, preparo.dono, log);
    if (!inicio.ok) {
      await completeJob(tx, job.id, ajudante.id);
      return { resposta: { seguir: false }, apagar };
    }
    await renewLease(tx, job.id, ajudante.id);
    return { resposta: { seguir: true }, apagar };
  });
  await apagarDepois(apagar, log);
  return resposta;
}

// -----------------------------------------------------------------------------
// A entrega
// -----------------------------------------------------------------------------

/** O que o motor respondeu: grava, conclui o job, e só então apaga o que sobrou. */
export async function entregar(
  ajudante: Ajudante,
  jobId: string,
  entrega: Entrega,
): Promise<void> {
  const log = registroDoAjudante({ ajudante: ajudante.id, jobId });

  if (entrega.tipo === "voz") {
    const apagar = await comoServico(async (tx) => {
      const job = await jobDoAjudante(tx, ajudante, jobId);
      const pedido = lerPedidoDeVoz(job.payload, job.professionalId);
      if (job.kind !== TIPO_IMPRESSAO_VOCAL || pedido === null) {
        throw new EntregaInvalida("este trabalho não é um cadastro de voz");
      }
      await gravarImpressaoVocal(tx, job.professionalId, entrega.impressao);
      await completeJob(tx, job.id, ajudante.id);
      return [pedido.chave];
    });
    await apagarDepois(apagar, log);
    return;
  }

  const lido = lerResultado(entrega.resultado);
  if (!lido.ok) throw new EntregaInvalida(lido.erro);

  const apagar = await comoServico(async (tx) => {
    const job = await jobDoAjudante(tx, ajudante, jobId);
    const preparo = await prepararTranscricao(tx, storage, sessaoDoJob(job), log);
    if (!preparo.ok) {
      await completeJob(tx, job.id, ajudante.id);
      return [];
    }
    const gravado = await gravarTranscricao(
      tx,
      preparo.sessao,
      lido.resultado,
      "ajudante",
      log,
    );
    await completeJob(tx, job.id, ajudante.id);
    // Truncada: os pedaços ficam, para reprocessar sem perdas.
    if (gravado.truncada) return [];
    const { fonte } = preparo;
    // Usou a reserva porque faltava pedaço: sai só o manifesto, como na estação.
    return fonte.tipo === "pedacos" && entrega.usouReserva
      ? fonte.apagarNoFim.slice(0, 1)
      : fonte.apagarNoFim;
  });
  await apagarDepois(apagar, log);
}

// -----------------------------------------------------------------------------
// A falha
// -----------------------------------------------------------------------------

/** Por que o ajudante não terminou — e o destino de cada motivo. */
export async function registrarFalha(
  ajudante: Ajudante,
  jobId: string,
  falha: Falha,
): Promise<void> {
  const log = registroDoAjudante({ ajudante: ajudante.id, jobId, falha: falha.tipo });

  const apagar = await comoServico(async (tx): Promise<string[]> => {
    const job = await jobDoAjudante(tx, ajudante, jobId);
    const amostra =
      job.kind === TIPO_IMPRESSAO_VOCAL
        ? lerPedidoDeVoz(job.payload, job.professionalId)
        : null;

    switch (falha.tipo) {
      case "erro": {
        const { exhausted } = await failJob(
          tx,
          job,
          falha.mensagem,
          false,
          ajudante.id,
        );
        // A amostra de voz não fica para trás quando as tentativas acabam.
        return exhausted && amostra !== null ? [amostra.chave] : [];
      }

      case "voz_curta": {
        await failJob(tx, job, VOZ_CURTA, true, ajudante.id);
        return amostra !== null ? [amostra.chave] : [];
      }

      case "audio_recusado": {
        await recusarAudio(tx, sessaoDoJob(job), falha.status, falha.motivo, log);
        await completeJob(tx, job.id, ajudante.id);
        return [];
      }

      case "pedaco_faltando": {
        const preparo = await prepararTranscricao(tx, storage, sessaoDoJob(job), log);
        if (!preparo.ok) {
          await completeJob(tx, job.id, ajudante.id);
          return [];
        }
        const { fonte } = preparo;
        const chave =
          fonte.tipo === "pedacos" ? fonte.pedacos[falha.indice] : undefined;
        // Confere: só um pedaço que de fato não existe encerra a consulta.
        // Qualquer outra coisa (rede, link vencido) é passageira.
        if (
          fonte.tipo !== "pedacos" ||
          chave === undefined ||
          (await storage.exists(chave))
        ) {
          await failJob(tx, job, "pedaço indisponível ao baixar", false, ajudante.id);
          return [];
        }
        const motivo = faltaOPedaco(falha.indice, fonte.pedacos.length);
        const reserva = await pedacoFaltando(tx, preparo.sessao.id, fonte, motivo, log);
        if (reserva !== null) {
          // Havia arquivo guardado: o ajudante devia tê-lo usado. Tenta de novo.
          await failJob(tx, job, "faltou pedaço, mas há reserva", false, ajudante.id);
          return [];
        }
        await completeJob(tx, job.id, ajudante.id);
        return [];
      }
    }
  });
  await apagarDepois(apagar, log);
}
