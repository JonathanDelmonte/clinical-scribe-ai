/**
 * A parte pesada de uma ordem de serviço, no computador da pessoa: o áudio e
 * o motor. Tudo o que decide e grava fica no site, que conduz as mesmas
 * etapas da estação (`@scribe/processamento`). Ver ADR-0005.
 *
 *   transcrever: baixar → [guardar a cópia] → avisar o site (quota)
 *                → transcrever, contando o andamento → entregar
 *   voz:         baixar a amostra → impressão vocal → entregar
 *
 * Durante qualquer etapa demorada, um renovador avisa o site a cada 20
 * segundos que o trabalho segue aqui. Sem isso, a concessão de dois minutos
 * venceria no meio de um download lento, e a estação começaria a refazer o
 * mesmo trabalho.
 */

import {
  converterParaM4a,
  ErroDoMotor,
  LocalTranscriptionProvider,
} from "@scribe/motor";
import {
  formatoParaGuardar,
  juntarBytes,
  type OrdemDeServico,
} from "@scribe/processamento/puro";

import { enderecoDoMotor } from "./caminhos";
import { registrar } from "./registro";
import { TrabalhoPerdido, type Site } from "./site";

type Ordem<T extends OrdemDeServico["tipo"]> = Extract<OrdemDeServico, { tipo: T }>;

const DEZ_MINUTOS = 10 * 60 * 1000;

async function baixar(
  url: string,
): Promise<
  { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; status: number }
> {
  const res = await fetch(url, { signal: AbortSignal.timeout(DEZ_MINUTOS) });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) };
}

async function enviar(url: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    body: bytes,
    headers: { "content-type": "application/octet-stream" },
    signal: AbortSignal.timeout(DEZ_MINUTOS),
  });
  if (!res.ok) throw new Error(`o armazenamento recusou a cópia (${res.status})`);
}

/** Executa uma ordem e conta ao site como terminou. Nunca lança. */
export async function executar(ordem: OrdemDeServico, site: Site): Promise<void> {
  registrar(
    `trabalho ${ordem.id}: ${ordem.tipo === "voz" ? "cadastro de voz" : "transcrição"}`,
  );
  const renovador = setInterval(() => {
    void site.andamento(ordem.id, {}).catch(() => undefined);
  }, 20_000);
  try {
    if (ordem.tipo === "voz") await executarVoz(ordem, site);
    else await executarTranscricao(ordem, site);
    registrar(`trabalho ${ordem.id}: concluído`);
  } catch (erro) {
    if (erro instanceof TrabalhoPerdido) {
      registrar(`trabalho ${ordem.id}: não está mais com este computador`);
      return;
    }
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    registrar(`trabalho ${ordem.id}: falhou (${mensagem})`);
    await site
      .falhar(ordem.id, {
        tipo: "erro",
        mensagem: `ajudante: ${mensagem}`.slice(0, 2000),
      })
      .catch(() => undefined);
  } finally {
    clearInterval(renovador);
  }
}

async function executarVoz(ordem: Ordem<"voz">, site: Site): Promise<void> {
  const amostra = await baixar(ordem.amostra);
  if (!amostra.ok)
    throw new Error(`a amostra de voz não pôde ser baixada (${amostra.status})`);
  const motor = new LocalTranscriptionProvider(enderecoDoMotor());
  try {
    const { embedding, durationSeconds } = await motor.enrollVoice(
      amostra.bytes,
      ordem.nome,
    );
    await site.entregar(ordem.id, {
      tipo: "voz",
      impressao: embedding,
      duracaoS: durationSeconds,
    });
  } catch (erro) {
    if (erro instanceof ErroDoMotor && erro.status === 400) {
      await site.falhar(ordem.id, { tipo: "voz_curta" });
      return;
    }
    throw erro;
  }
}

async function executarTranscricao(
  ordem: Ordem<"transcrever">,
  site: Site,
): Promise<void> {
  // ---- baixar ------------------------------------------------------------
  let audio: Uint8Array<ArrayBuffer> | null = null;
  let nome = ordem.audio.nome;
  let usouReserva = false;
  const pedacos: Uint8Array[] = [];
  for (const [indice, url] of ordem.audio.partes.entries()) {
    const baixado = await baixar(url);
    if (baixado.ok) {
      pedacos.push(baixado.bytes);
      continue;
    }
    if (baixado.status < 400 || baixado.status >= 500) {
      throw new Error(`o download do áudio falhou (${baixado.status})`);
    }
    // 4xx: o pedaço provavelmente não existe. Com reserva (o arquivo já
    // guardado numa tentativa anterior), segue com ela; sem, o site confere e
    // encerra a consulta como incompleta.
    if (ordem.reserva === null) {
      await site.falhar(ordem.id, { tipo: "pedaco_faltando", indice });
      return;
    }
    const reserva = await baixar(ordem.reserva.url);
    if (!reserva.ok)
      throw new Error(`a reserva não pôde ser baixada (${reserva.status})`);
    audio = reserva.bytes;
    nome = ordem.reserva.nome;
    usouReserva = true;
    break;
  }
  if (audio === null) {
    const juntado = juntarBytes(pedacos);
    if (!juntado.ok) throw new Error(juntado.motivo);
    audio = juntado.bytes;
  }

  // ---- a cópia guardada ------------------------------------------------------
  let guardado: { formato: "wav" | "m4a"; duracaoMs: number | null } | null = null;
  if (ordem.guarda !== null && !usouReserva) {
    const formato = formatoParaGuardar(ordem.guarda, audio.byteLength);
    let copia: { bytes: Uint8Array<ArrayBuffer>; duracaoMs: number | null } | null =
      null;
    if (formato === "wav") {
      copia = { bytes: audio, duracaoMs: null };
    } else {
      try {
        const convertido = await converterParaM4a(
          enderecoDoMotor(),
          audio,
          nome,
          ordem.guarda.limiteBytes,
        );
        if (!convertido.ok) {
          await site.falhar(ordem.id, {
            tipo: "audio_recusado",
            status: convertido.status,
            motivo: convertido.motivo,
          });
          return;
        }
        copia = { bytes: convertido.bytes, duracaoMs: convertido.duracaoMs };
      } catch (erro) {
        // Em pedaços, sem a cópia não há arquivo final: a fila tenta de novo.
        // Fora disso, transcreve-se o original mesmo assim.
        if (ordem.guarda.obrigatoria) throw erro;
        registrar(`conversão indisponível; seguindo sem a cópia (${String(erro)})`);
      }
    }
    if (copia !== null) {
      await enviar(
        formato === "wav" ? ordem.guarda.envioWav : ordem.guarda.envioM4a,
        copia.bytes,
      );
      guardado = { formato, duracaoMs: copia.duracaoMs };
    }
  }

  const resposta = await site.audio(ordem.id, { guardado, usouReserva });
  if (!resposta.seguir) return;

  // ---- transcrever -------------------------------------------------------------
  const motor = new LocalTranscriptionProvider(enderecoDoMotor());
  let acompanhando = true;
  const acompanhamento = (async () => {
    while (acompanhando) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!acompanhando) break;
      const p = await motor.progress(ordem.id);
      if (p === null) continue;
      await site
        .andamento(ordem.id, {
          percent: Math.max(0, Math.min(100, p.percent)),
          fase: p.phaseLabel.slice(0, 80),
          etaS: p.etaSeconds,
          previa: p.preview === null ? null : p.preview.slice(0, 500),
        })
        .catch(() => undefined);
    }
  })();

  let resultado;
  try {
    resultado = await motor.transcribe({
      audio,
      filename: nome,
      diarize: true,
      jobId: ordem.id,
      language: ordem.motor.idioma,
      professionalEmbedding: ordem.motor.impressaoVocal,
      vocabulary: ordem.motor.vocabulario,
      durationMs: ordem.motor.duracaoMs,
    });
  } finally {
    acompanhando = false;
    await acompanhamento;
  }

  await site.entregar(ordem.id, { tipo: "transcricao", resultado, usouReserva });
}
