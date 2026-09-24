"use client";

import { medirSegundoMicrofone } from "@scribe/audio-browser";
import {
  lerEstadoDoSegundoMicrofone,
  type EstadoDoSegundoMicrofone,
  type LadoDoSegundo,
} from "@scribe/core";
import { useEffect, useRef, useState } from "react";

type Fase =
  | { readonly tipo: "parado" }
  | { readonly tipo: "medindo" }
  | { readonly tipo: "enviando" }
  | { readonly tipo: "processando" }
  | { readonly tipo: "erro"; readonly mensagem: string };

/** Menos que isto não é uma consulta — é um teste de gravador. */
const DURACAO_MINIMA_S = 30;

/**
 * O segundo microfone: um celular perto do paciente, e quem falou decidido
 * por qual dos dois ouviu mais alto.
 *
 * A separação por voz falha com máscara e microfone de celular — as duas vozes
 * ficam parecidas demais. Dois microfones trocam a pergunta "que voz é esta?"
 * por "qual microfone ouviu mais alto?", que não depende do timbre de ninguém.
 *
 * ## O que sai deste computador
 *
 * Só a medida: a energia da gravação a cada 5 ms. O arquivo do celular é lido
 * aqui, medido aqui, e fica aqui — ver `envelope.ts` em @scribe/audio-browser.
 * A tela diz isso, porque é a pergunta que um profissional de saúde deveria
 * fazer antes de enviar a gravação de um paciente para qualquer lugar.
 */
export function SegundoMicrofone({
  sessionId,
  estadoGravado,
  bloqueio,
  notaGeradaEm,
  onAplicado,
}: {
  sessionId: string;
  /** `sessions.channel_diarization`, como veio do banco. */
  estadoGravado: unknown;
  /** Por que não dá para enviar agora — nota aprovada, por exemplo. */
  bloqueio: string | null;
  /** Quando a nota atual foi gerada; `null` sem nota. */
  notaGeradaEm: string | null;
  onAplicado: () => void;
}) {
  /**
   * O que veio do banco, sobreposto pelo que ESTA tela ficou sabendo depois:
   * o envio que ela fez e o resultado que ela consultou. `undefined` = nada
   * novo aqui, vale o do banco.
   */
  const [visto, setVisto] = useState<EstadoDoSegundoMicrofone | null | undefined>(
    undefined,
  );
  const estado =
    visto !== undefined ? visto : lerEstadoDoSegundoMicrofone(estadoGravado);

  const [fase, setFase] = useState<Fase>(() =>
    lerEstadoDoSegundoMicrofone(estadoGravado)?.estado === "na_fila"
      ? { tipo: "processando" }
      : { tipo: "parado" },
  );
  const [aberto, setAberto] = useState(false);
  const [lado, setLado] = useState<LadoDoSegundo>("patient");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const ocupado = fase.tipo === "medindo" || fase.tipo === "enviando";

  // Referência estável: a função do pai muda a cada render, e o laço de
  // consulta abaixo recomeçaria a cada um.
  const aoAplicar = useRef(onAplicado);
  useEffect(() => {
    aoAplicar.current = onAplicado;
  });

  /**
   * Pergunta pelo resultado enquanto o worker processa.
   *
   * Termina quando o job sai da fila — terminado ou falho de vez. Um job que
   * falhou e vai ser tentado de novo volta para `pending`, e a consulta
   * continua.
   */
  useEffect(() => {
    if (fase.tipo !== "processando") return;
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function perguntar() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/segundo-microfone`, {
          cache: "no-store",
        });
        if (res.ok) {
          const corpo = (await res.json()) as {
            estado: unknown;
            job: { status: string; error: string | null } | null;
          };
          if (!vivo) return;
          const ativo =
            corpo.job !== null &&
            (corpo.job.status === "pending" || corpo.job.status === "running");
          if (!ativo) {
            const novo = lerEstadoDoSegundoMicrofone(corpo.estado);
            setVisto(novo);
            if (corpo.job?.status === "failed") {
              setFase({
                tipo: "erro",
                mensagem: `o processamento falhou${corpo.job.error !== null ? `: ${corpo.job.error}` : ""}`,
              });
            } else {
              setFase({ tipo: "parado" });
              if (novo?.estado === "aplicado") aoAplicar.current();
            }
            return;
          }
        }
      } catch {
        // Rede oscilou. A próxima volta tenta de novo.
      }
      if (vivo) timer = setTimeout(() => void perguntar(), 2000);
    }

    void perguntar();
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [fase.tipo, sessionId]);

  async function enviar() {
    if (arquivo === null) return;

    setFase({ tipo: "medindo" });
    let medida: Awaited<ReturnType<typeof medirSegundoMicrofone>>;
    try {
      medida = await medirSegundoMicrofone(arquivo);
    } catch {
      setFase({
        tipo: "erro",
        mensagem:
          "o navegador não conseguiu ler este arquivo. Se ele for .3gp ou .amr (gravadores antigos de Android), exporte do celular como MP3 ou M4A.",
      });
      return;
    }
    if (medida.duracaoS < DURACAO_MINIMA_S) {
      setFase({
        tipo: "erro",
        mensagem:
          "gravação curta demais — o segundo celular precisa gravar a consulta inteira",
      });
      return;
    }

    setFase({ tipo: "enviando" });
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/segundo-microfone?perto=${lado === "patient" ? "paciente" : "profissional"}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: medida.bytes,
        },
      );
      const corpo = (await res.json().catch(() => null)) as {
        estado?: unknown;
        error?: string;
      } | null;
      if (!res.ok) {
        setFase({ tipo: "erro", mensagem: corpo?.error ?? "não foi possível enviar" });
        return;
      }
      setVisto(lerEstadoDoSegundoMicrofone(corpo?.estado));
      setAberto(false);
      setArquivo(null);
      setFase({ tipo: "processando" });
    } catch {
      setFase({
        tipo: "erro",
        mensagem: "sem resposta do servidor — confira a conexão e tente de novo",
      });
    }
  }

  const processando = fase.tipo === "processando";
  const podeAbrir = bloqueio === null && !processando && !ocupado;
  const notaVelha =
    estado?.estado === "aplicado" &&
    notaGeradaEm !== null &&
    estado.processadoEm !== undefined &&
    notaGeradaEm < estado.processadoEm;

  return (
    <section className="rounded-lg border border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-xs font-medium tracking-widest text-muted uppercase">
          Segundo microfone
        </h2>

        {processando ? (
          <span className="inline-flex items-center gap-2 text-sm text-accent">
            <span className="size-2 animate-pulse rounded-full bg-current" />
            comparando os dois microfones…
          </span>
        ) : estado?.estado === "aplicado" ? (
          <span className="text-sm text-accent">quem falou foi refeito pelos dois</span>
        ) : estado?.estado === "recusado" ? (
          <span className="text-sm text-amber-500">não aplicado — nada mudou</span>
        ) : (
          <span className="text-sm text-muted">
            separa quem falou pelo volume de dois celulares
          </span>
        )}

        {podeAbrir && !aberto && (
          <button
            onClick={() => {
              setAberto(true);
              if (fase.tipo === "erro") setFase({ tipo: "parado" });
            }}
            className="ml-auto rounded-md border border-line px-3 py-1 text-xs hover:border-accent"
          >
            {estado === null ? "usar" : "enviar outra gravação"}
          </button>
        )}
      </div>

      {estado?.estado === "aplicado" && !processando && (
        <div className="mt-2 space-y-1.5 text-xs">
          <p>
            <strong className="font-medium">{estado.medidos ?? 0}</strong>{" "}
            {(estado.medidos ?? 0) === 1 ? "trecho decidido" : "trechos decididos"}{" "}
            pelos dois microfones
            {(estado.preservados ?? 0) > 0 && (
              <>
                {" "}
                · <strong className="font-medium">{estado.preservados}</strong> que você
                corrigiu, {estado.preservados === 1 ? "mantido" : "mantidos"}
              </>
            )}
            {(estado.semMedida ?? 0) > 0 && (
              <>
                {" "}
                · <strong className="font-medium">{estado.semMedida}</strong> sem
                medida, {estado.semMedida === 1 ? "como estava" : "como estavam"}
              </>
            )}
            .
          </p>
          <p className="text-muted">
            segundo celular perto{" "}
            {estado.segundoPerto === "patient" ? "do paciente" : "do profissional"}
            {estado.deslocamentoS !== undefined && (
              <>
                {" "}
                · começou{" "}
                {Math.abs(estado.deslocamentoS).toLocaleString("pt-BR", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}{" "}
                s {estado.deslocamentoS >= 0 ? "depois" : "antes"}
              </>
            )}
            {estado.separacaoDb != null && (
              <> · {Math.round(estado.separacaoDb)} dB de diferença entre os lados</>
            )}
            {estado.cobertura != null && (
              <> · gravou {Math.round(estado.cobertura * 100)}% da consulta</>
            )}
          </p>
          {estado.conteudoDiscorda === true && (
            <p className="text-amber-500">
              O que foi dito na consulta sugere o contrário da posição informada —
              talvez o segundo celular estivesse perto de você. Confira a transcrição;
              se os papéis estiverem invertidos, use “trocar” em Quem é quem.
            </p>
          )}
          {notaVelha && (
            <p className="text-amber-500">
              A nota foi gerada antes desta correção. Gere de novo para que ela reflita
              quem falou.
            </p>
          )}
        </div>
      )}

      {estado?.estado === "recusado" && !processando && (
        <p className="mt-2 text-xs text-amber-500">
          Os dois microfones não bastaram para separar as pessoas: {estado.motivo}. A
          transcrição ficou como estava.
        </p>
      )}

      {fase.tipo === "erro" && (
        <p role="alert" className="mt-2 text-xs text-red-500">
          {fase.mensagem}
        </p>
      )}

      {bloqueio !== null && estado === null && (
        <p className="mt-2 text-xs text-muted">{bloqueio}</p>
      )}

      {aberto && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
            <li>
              Deixe um segundo celular gravando perto do paciente, com o gravador do
              próprio celular, do começo ao fim da consulta. Pode começar até 2 minutos
              antes ou depois deste app.
            </li>
            <li>Depois, escolha aqui o arquivo que o celular gravou.</li>
          </ol>
          <p className="text-xs text-muted">
            A gravação não sai deste computador: o navegador mede só o volume dela a
            cada 5 milésimos de segundo e envia essa medida, que não contém nenhuma
            palavra.
          </p>

          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <legend className="mb-1 text-xs text-muted">
              Onde ficou o segundo celular?
            </legend>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name={`lado-${sessionId}`}
                checked={lado === "patient"}
                onChange={() => setLado("patient")}
              />
              perto do paciente
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name={`lado-${sessionId}`}
                checked={lado === "professional"}
                onChange={() => setLado("professional")}
              />
              perto de mim
            </label>
          </fieldset>

          <input
            type="file"
            accept="audio/*,video/mp4,.m4a,.mp3,.wav,.ogg,.opus,.aac,.webm,.flac"
            aria-label="Gravação do segundo celular"
            onChange={(e) => setArquivo(e.currentTarget.files?.[0] ?? null)}
            className="block w-full text-xs"
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void enviar()}
              disabled={arquivo === null || ocupado}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface disabled:opacity-40"
            >
              {fase.tipo === "medindo"
                ? "Medindo o volume…"
                : fase.tipo === "enviando"
                  ? "Enviando a medida…"
                  : "Enviar"}
            </button>
            <button
              onClick={() => {
                setAberto(false);
                setArquivo(null);
                if (fase.tipo === "erro") setFase({ tipo: "parado" });
              }}
              disabled={ocupado}
              className="text-xs text-muted underline underline-offset-2 hover:text-ink disabled:opacity-40"
            >
              cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
