/**
 * Handler do segundo microfone — refaz QUEM FALOU a partir de dois canais.
 *
 *   áudio da sessão + envelope do segundo microfone → motor alinha e compara
 *   energia → turnos por lado → rótulo e papel novos nos trechos que já existem
 *
 * O texto não é tocado, os IDs não mudam, e trecho corrigido à mão fica como
 * está. O papel sai da posição que o profissional declarou ao enviar — ver
 * `reatribuirPorCanais` e `atribuicaoDosCanais` em @scribe/core.
 *
 * Quando o motor responde `confiavel: false`, NADA muda nos trechos: a
 * diarização por voz que já existia continua valendo, e a sessão guarda o
 * motivo para a tela mostrar. Trocar uma atribuição imperfeita por uma que o
 * próprio algoritmo declarou não confiável seria piorar em nome de melhorar.
 */

import {
  atribuicaoDosCanais,
  identifyRolesByContent,
  lerEstadoDoSegundoMicrofone,
  reatribuirPorCanais,
  type EstadoDoSegundoMicrofone,
} from "@scribe/core";
import { auditLog, sessions, transcriptSegments, type Database } from "@scribe/db";
import { secondChannelKey, type AudioStorage } from "@scribe/storage";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Logger } from "pino";

import { config } from "../config.js";
import { diarizarPorCanais, medirSegundoMicrofoneNoMotor } from "../providers/local.js";
import type { ClaimedJob } from "../queue.js";

export function makeChannelsHandler(
  db: Database,
  storage: AudioStorage,
  logger: Logger,
) {
  return async function handleDiarizeChannels(job: ClaimedJob): Promise<void> {
    const { sessionId } = job;
    if (sessionId === null) throw new Error("job de segundo microfone sem sessão");
    const log = logger.child({ sessionId, jobId: job.id });

    const [sessao] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (sessao === undefined) throw new Error(`sessão ${sessionId} não encontrada`);
    if (sessao.audioPath === null || sessao.secondChannelPath === null) {
      throw new Error("a sessão precisa do áudio e do segundo microfone");
    }

    const pedido = lerEstadoDoSegundoMicrofone(sessao.channelDiarization);
    if (pedido === null) {
      // Sem saber onde o segundo aparelho ficou, não há como dizer quem é quem.
      // Adivinhar trocaria os papéis da transcrição inteira metade das vezes.
      throw new Error(
        "pedido do segundo microfone ilegível — falta onde o aparelho ficou",
      );
    }

    // O pedido pode ganhar a duração medida no caminho de reserva, abaixo, e o
    // arquivo pode trocar de original para medida; a recusa precisa enxergar a
    // versão mais recente dos dois.
    let pedidoAtual = pedido;
    let arquivoDoSegundo = sessao.secondChannelPath;

    const recusar = async (motivo: string): Promise<void> => {
      // Um original que não chegou a virar medida não fica para trás: é a
      // gravação do lado do paciente, e só estava aqui para ser medida.
      const descartar = !arquivoDoSegundo.endsWith(".cve");
      if (descartar) await storage.remove(arquivoDoSegundo);
      await db
        .update(sessions)
        .set({
          ...(descartar ? { secondChannelPath: null } : {}),
          channelDiarization: {
            ...pedidoAtual,
            estado: "recusado",
            motivo,
            processadoEm: new Date().toISOString(),
          } satisfies EstadoDoSegundoMicrofone,
        })
        .where(eq(sessions.id, sessionId));
      log.info({ motivo }, "segundo microfone recusado — atribuição mantida");
    };

    // Nota aprovada é registro assinado. Mudar quem disse o quê debaixo dela
    // alteraria o que o profissional atestou — sem ele saber. A rota já recusa;
    // isto cobre a aprovação que acontece entre o envio e o processamento.
    if (sessao.status === "approved") {
      await recusar(
        "a nota foi aprovada antes do processamento — quem falou não muda debaixo de um registro assinado",
      );
      return;
    }
    if (sessao.audioDeletedAt !== null) {
      await recusar("o áudio desta consulta já foi apagado pela política de retenção");
      return;
    }

    // ---- o caminho de reserva ---------------------------------------------
    //
    // Normalmente o navegador já mandou a medida (`.cve`). Quando ele não
    // conseguiu ler o formato do celular — AMR, WMA, ALAC —, mandou o arquivo
    // como veio, e é aqui que ele vira medida. O original sai logo depois de a
    // medida estar gravada e apontada: é a gravação do lado do paciente, e
    // guardá-la era justamente o que o desenho evitava.
    let envelope: Uint8Array<ArrayBuffer>;
    if (sessao.secondChannelPath.endsWith(".cve")) {
      envelope = await storage.get(sessao.secondChannelPath);
    } else {
      const original = sessao.secondChannelPath;
      const medida = await medirSegundoMicrofoneNoMotor(
        config.ASR_LOCAL_URL,
        await storage.get(original),
        original,
      );
      if (!medida.ok) {
        await recusar(
          `o arquivo do segundo celular não pôde ser lido (${medida.motivo})`,
        );
        return;
      }
      const destino = secondChannelKey(sessao.professionalId, sessao.id);
      pedidoAtual = { ...pedido, duracaoS: Math.round(medida.duracaoMs / 1000) };
      await storage.put(destino, medida.bytes);
      await db
        .update(sessions)
        .set({ secondChannelPath: destino, channelDiarization: pedidoAtual })
        .where(eq(sessions.id, sessionId));
      arquivoDoSegundo = destino;
      await storage.remove(original);
      envelope = medida.bytes;
      log.info("segundo microfone medido no motor; original apagado");
    }

    const principal = await storage.get(sessao.audioPath);

    // O áudio da sessão pode ter chegado sem o silêncio (o navegador corta). A
    // duração original é a enxuta mais o que foi removido.
    const duracaoOriginalMs =
      sessao.durationMs === null
        ? null
        : sessao.durationMs + (sessao.silenceRemovedMs ?? 0);

    const resultado = await diarizarPorCanais(config.ASR_LOCAL_URL, {
      principal,
      nomePrincipal: sessao.audioPath,
      envelope,
      regioes: sessao.speechRegions,
      duracaoOriginalMs,
    });

    const medido = {
      deslocamentoS: resultado.alinhamento.deslocamento_s,
      derivaPpm: resultado.alinhamento.deriva_ppm,
      qualidade: resultado.alinhamento.qualidade,
      separacaoDb: resultado.separacao_db ?? null,
      cobertura: resultado.cobertura ?? null,
    };

    if (!resultado.confiavel) {
      await db
        .update(sessions)
        .set({
          channelDiarization: {
            ...pedidoAtual,
            ...medido,
            estado: "recusado",
            motivo: resultado.motivo,
            processadoEm: new Date().toISOString(),
          } satisfies EstadoDoSegundoMicrofone,
        })
        .where(eq(sessions.id, sessionId));
      log.info(
        { motivo: resultado.motivo, ...medido },
        "segundo microfone não confiável — atribuição mantida",
      );
      return;
    }

    const linhas = await db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.sessionId, sessionId))
      .orderBy(asc(transcriptSegments.startMs));

    if (linhas.length === 0) {
      await recusar("a consulta ainda não tem transcrição");
      return;
    }

    const novos = reatribuirPorCanais(
      linhas,
      resultado.turnos.map(([inicioS, fimS, falante]) => ({ inicioS, fimS, falante })),
      pedidoAtual.segundoPerto,
    );

    // O conteúdo confere a posição declarada — só nos trechos que os canais
    // mediram. Os sem medida carregam o papel antigo, e entrariam na conta
    // concordando com a atribuição que o segundo microfone veio corrigir.
    const texto = new Map(linhas.map((l) => [l.id, l.text]));
    const porConteudo = identifyRolesByContent(
      novos
        .filter((n) => n.origem !== "sem_medida")
        .map((n) => ({ speakerLabel: n.speakerLabel, text: texto.get(n.id) ?? "" })),
    );
    const { atribuicao, conteudoDiscorda } = atribuicaoDosCanais(
      pedidoAtual.segundoPerto,
      porConteudo,
    );

    const contagem = {
      medidos: novos.filter((n) => n.origem === "medido").length,
      preservados: novos.filter((n) => n.origem === "preservado").length,
      semMedida: novos.filter((n) => n.origem === "sem_medida").length,
    };

    await db.transaction(async (tx) => {
      for (const n of novos) {
        if (n.origem === "medido") {
          await tx
            .update(transcriptSegments)
            .set({
              speakerLabel: n.speakerLabel,
              role: n.role,
              roleSource: n.roleSource,
            })
            .where(
              and(
                eq(transcriptSegments.id, n.id),
                // A leitura acima pode ter ficado velha: o profissional corrige
                // trechos enquanto isto roda. Correção feita no meio do
                // caminho vence, como qualquer outra.
                sql`not (${transcriptSegments.roleSource} = 'manual' and ${transcriptSegments.correctedAt} is not null)`,
              ),
            );
        } else {
          // Preservado ou sem medida: só o rótulo muda, o papel fica.
          await tx
            .update(transcriptSegments)
            .set({ speakerLabel: n.speakerLabel })
            .where(eq(transcriptSegments.id, n.id));
        }
      }

      await tx
        .update(sessions)
        .set({
          roleAssignment: atribuicao,
          channelDiarization: {
            ...pedidoAtual,
            ...medido,
            ...contagem,
            estado: "aplicado",
            motivo: null,
            conteudoDiscorda,
            processadoEm: new Date().toISOString(),
          } satisfies EstadoDoSegundoMicrofone,
        })
        .where(eq(sessions.id, sessionId));

      /**
       * Quem falou é parte do prontuário: a nota diz "o paciente relata" com
       * base nisso. Uma mudança em massa nos papéis precisa aparecer na
       * trilha, com `actor_id` nulo — quem mudou foi o processamento que o
       * profissional pediu, não uma pessoa editando. Só contagens: nenhum
       * conteúdo de consulta entra aqui.
       */
      await tx.insert(auditLog).values({
        actorId: null,
        professionalId: sessao.professionalId,
        action: "sessao.segundo_microfone_aplicado",
        entity: "sessions",
        entityId: sessao.id,
        metadata: { ...contagem, conteudoDiscorda },
      });
    });

    log.info(
      {
        ...medido,
        ...contagem,
        conteudoDiscorda,
        segundoPerto: pedidoAtual.segundoPerto,
      },
      "quem falou refeito pelos dois microfones",
    );
  };
}
