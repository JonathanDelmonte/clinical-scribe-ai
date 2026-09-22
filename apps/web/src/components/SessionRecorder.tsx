"use client";

import { prepareForUpload } from "@scribe/audio-browser";
import { useRouter } from "next/navigation";

import { LiveDraft } from "./LiveDraft";
import {
  CONSENT_METHOD_LABEL,
  CONSENT_METHODS,
  textoParaExibicao,
  type ConsentMethod,
} from "@/lib/consent";
import { useLiveDraft } from "@/lib/useLiveDraft";
import { useEffect, useRef, useState } from "react";

type Engine = "local" | "cloud";

/**
 * Escolhe o formato que ESTE navegador realmente grava.
 *
 * `audio/webm;codecs=opus` funciona no Chrome e no Firefox; o Safari só
 * entrega `audio/mp4`. Passar um mimeType não suportado faz o MediaRecorder
 * lançar na construção — então perguntar antes é mais barato que tratar o erro
 * depois. `undefined` deixa o navegador escolher o padrão dele.
 */
function pickMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

function extensionFor(mimeType: string | undefined): string {
  if (mimeType === undefined) return "webm";
  if (mimeType.startsWith("audio/mp4")) return "m4a";
  if (mimeType.startsWith("audio/ogg")) return "ogg";
  return "webm";
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function SessionRecorder({
  patientId,
  canChooseEngine,
  defaultEngine,
  minutosRestantes,
}: {
  patientId: string;
  canChooseEngine: boolean;
  defaultEngine: Engine;
  /** `null` = plano sem teto. Ver packages/core/src/account.ts. */
  minutosRestantes: number | null;
}) {
  const router = useRouter();

  const [consent, setConsent] = useState(false);
  const [consentMethod, setConsentMethod] = useState<ConsentMethod>("verbal-in-person");
  const [objective, setObjective] = useState("");
  const [engine, setEngine] = useState<Engine | "">("");
  const [recording, setRecording] = useState(false);
  const rascunho = useLiveDraft();
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  /**
   * Se o `onstop` que vem a seguir deve descartar em vez de enviar.
   *
   * Um ref, e não estado: `onstop` é um retorno de chamada preso ao
   * MediaRecorder na hora em que ele foi criado, e leria o estado congelado
   * daquele instante. Aqui a diferença entre ler o valor velho e o novo é
   * enviar uma gravação que a pessoa mandou descartar.
   */
  const descartarRef = useRef(false);

  // Soltar o microfone ao sair da página. Sem isto o indicador de gravação
  // continua aceso no navegador, o que é assustador num app de saúde — e é a
  // reclamação certa.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  /**
   * Avisa antes de fechar a aba com gravação em andamento.
   *
   * A mesma falta que o botão de descartar cobre, pelo outro lado: sair da
   * página no meio da consulta apaga tudo sem perguntar nada. A diferença é
   * que descartar é uma escolha e fechar a aba costuma ser um acidente — um
   * toque errado, um atalho do teclado, o navegador restaurando sessão.
   *
   * O navegador mostra um texto próprio e ignora qualquer mensagem que a
   * gente tente passar. O que importa é existir a pergunta.
   */
  useEffect(() => {
    if (!recording) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [recording]);

  async function createSessionAndUpload(file: File) {
    setError(null);
    setStatus("criando sessão…");

    const created = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId,
        objectiveText: objective.trim() === "" ? undefined : objective.trim(),
        engineChoice: engine === "" ? null : engine,
        consentMethod,
      }),
    });

    if (!created.ok) {
      setStatus(null);
      setError("não foi possível criar a sessão");
      return;
    }

    const { session } = (await created.json()) as { session: { id: string } };

    // ---- a metade do navegador ------------------------------------------
    //
    // O dispositivo reamostra para 16 kHz mono e corta o silêncio ANTES de
    // enviar. Reamostrar é ganho puro: o Whisper converte para 16 kHz de
    // qualquer jeito, então mandar 48 kHz estéreo é subir seis vezes mais
    // bytes para o servidor descartar cinco sextos.
    //
    // E o ruído da sala — o silêncio entre as falas — nunca sai daqui.
    setStatus("preparando o áudio no seu dispositivo…");

    let envio = file;
    let mapa: { regions: unknown; removedMs: number; durationMs: number } | null = null;

    try {
      const pronto = await prepareForUpload(file);
      envio = pronto.file;
      // `trimmedMs` e não `originalMs`: o que a quota cobra é o que vai ser
      // transcrito, e o silêncio cortado não chega a ser transcrito.
      mapa = {
        regions: pronto.regions,
        removedMs: pronto.removedMs,
        durationMs: pronto.trimmedMs,
      };

      const economia = 1 - pronto.bytes / pronto.originalBytes;
      setStatus(
        `${(pronto.bytes / 1024 / 1024).toFixed(1)} MB` +
          (economia > 0.05 ? ` · ${Math.round(economia * 100)}% menor` : "") +
          (pronto.removedMs > 2000
            ? ` · ${Math.round(pronto.removedMs / 1000)}s de silêncio removidos`
            : ""),
      );
    } catch {
      // Codec que o navegador não decodifica, memória insuficiente num celular
      // antigo, AudioContext bloqueado. Enviar o original é a degradação certa:
      // upload maior e processamento mais lento, nunca consulta perdida.
      setStatus(`enviando ${(file.size / 1024 / 1024).toFixed(1)} MB…`);
    }

    const form = new FormData();
    form.append("file", envio);
    if (mapa !== null) form.append("audioMap", JSON.stringify(mapa));

    const uploaded = await fetch(`/api/sessions/${session.id}/audio`, {
      method: "POST",
      body: form,
    });

    if (!uploaded.ok) {
      const body: unknown = await uploaded.json().catch(() => null);
      const mensagem =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : "falha no envio";

      /**
       * Quota estourada (402) não é falha de envio: o áudio FOI guardado, e a
       * sessão existe com o motivo escrito nela. Ficar nesta tela com uma
       * mensagem vermelha daria a impressão de que a consulta se perdeu — que
       * é exatamente o oposto do que aconteceu.
       */
      if (uploaded.status === 402) {
        router.push(`/sessoes/${session.id}`);
        return;
      }

      setStatus(null);
      setError(mensagem);
      return;
    }

    router.push(`/sessoes/${session.id}`);
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType === undefined ? undefined : { mimeType },
      );
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        if (descartarRef.current) {
          descartarRef.current = false;
          chunksRef.current = [];
          setStatus(null);
          setElapsed(0);
          return;
        }

        const blob = new Blob(chunksRef.current, {
          type: mimeType ?? "audio/webm",
        });
        const file = new File([blob], `consulta.${extensionFor(mimeType)}`, {
          type: blob.type,
        });
        void createSessionAndUpload(file);
      };

      // Pedaços de 1s. Se a aba cair no meio, o que já chegou está no array em
      // vez de perdido num buffer interno — a base para retomada de sessão,
      // que o consultório de internet instável vai exigir.
      recorder.start(1000);
      recorderRef.current = recorder;
      setElapsed(0);
      setRecording(true);

      // Roda em paralelo, no MESMO fluxo de microfone, e sem `await`: o
      // rascunho baixa um modelo na primeira vez, e esperar por ele atrasaria
      // o início da gravação — que é a única coisa aqui que não pode falhar.
      void rascunho.iniciar(stream);
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "permissão de microfone negada — libere no navegador e tente de novo"
          : "não foi possível acessar o microfone",
      );
    }
  }

  function stopRecording() {
    setRecording(false);
    setConfirmandoCancelamento(false);
    setStatus("processando gravação…");
    rascunho.parar();
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  /**
   * Descarta a gravação em andamento.
   *
   * Pede confirmação, e isso não é excesso de zelo: a consulta que está sendo
   * gravada aconteceu uma vez. Não existe desfazer, não existe regravar — as
   * pessoas já foram embora. É a única ação desta tela que destrói algo
   * irrecuperável, e a única que merece uma pergunta no meio.
   */
  function cancelRecording() {
    if (!confirmandoCancelamento) {
      setConfirmandoCancelamento(true);
      return;
    }
    descartarRef.current = true;
    setRecording(false);
    setConfirmandoCancelamento(false);
    setError(null);
    rascunho.parar();
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  const busy = status !== null;
  const ready = consent && !busy;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-line px-4 py-3">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={busy || recording}
          />
          <span className="text-sm">
            O paciente foi informado de que a consulta será gravada.
            <span className="mt-1 block text-xs text-muted">
              A base legal do tratamento é a tutela da saúde (LGPD Art. 11, II,
              &ldquo;f&rdquo;), mas a transparência é obrigatória: o paciente precisa
              estar ciente.
            </span>
          </span>
        </label>

        {/*
         * O método aparece só depois da confirmação, e é isso que fica
         * gravado na sessão junto com o texto correspondente. Perguntar antes
         * de a pessoa confirmar seria pedir um detalhe sobre algo que ela
         * ainda não disse ter feito.
         */}
        {consent && (
          <div className="mt-3 border-t border-line pt-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium tracking-widest text-muted uppercase">
                Como foi informado
              </span>
              <select
                className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
                value={consentMethod}
                onChange={(e) => setConsentMethod(e.target.value as ConsentMethod)}
                disabled={busy || recording}
              >
                {CONSENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {CONSENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-2 text-xs text-muted">
              Fica registrado nesta sessão: &ldquo;{textoParaExibicao(consentMethod)}
              &rdquo;
            </p>
          </div>
        )}
      </div>

      {minutosRestantes !== null && (
        <p
          className={`text-xs ${minutosRestantes <= 0 ? "text-red-500" : "text-muted"}`}
        >
          {minutosRestantes <= 0
            ? "Quota do mês esgotada. A gravação é guardada, mas só será processada no próximo mês ou com outro plano."
            : `Restam ${Math.floor(minutosRestantes)} minutos de processamento neste mês.`}
        </p>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-medium tracking-widest text-muted uppercase">
          Objetivo desta sessão (opcional)
        </span>
        <input
          className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm placeholder:text-muted"
          placeholder="ex.: gerar plano alimentar e pontos de acompanhamento"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          disabled={busy}
        />
      </label>

      {canChooseEngine && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium tracking-widest text-muted uppercase">
            Motor de transcrição
          </span>
          <select
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
            value={engine}
            onChange={(e) => setEngine(e.target.value as Engine | "")}
            disabled={busy}
          >
            <option value="">padrão do plano ({defaultEngine})</option>
            <option value="local">local — Whisper no servidor</option>
            <option value="cloud">cloud — API comercial</option>
          </select>
          <span className="mt-1 block text-xs text-muted">
            Disponível porque seu cargo é <code>developer</code>.
          </span>
        </label>
      )}

      <LiveDraft estado={rascunho.estado} trechos={rascunho.trechos} />

      <div className="flex flex-wrap items-center gap-3">
        {recording ? (
          <>
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 font-medium text-white"
            >
              <span className="size-2.5 animate-pulse rounded-full bg-white" />
              Parar · {formatElapsed(elapsed)}
            </button>

            {/*
             * Descartar fica DEPOIS de parar, e discreto.
             *
             * São ações opostas com consequências muito diferentes, e a
             * destrutiva não pode disputar atenção com a normal. Quem
             * termina a consulta clica no vermelho sem pensar; quem quer
             * jogar fora procura — e encontra.
             */}
            <button
              onClick={cancelRecording}
              className={`rounded-lg px-4 py-2.5 text-sm ${
                confirmandoCancelamento
                  ? "bg-red-500/15 font-medium text-red-500"
                  : "text-muted underline underline-offset-2 hover:text-ink"
              }`}
            >
              {confirmandoCancelamento
                ? "Confirmar: apagar esta gravação"
                : "descartar"}
            </button>

            {confirmandoCancelamento && (
              <button
                onClick={() => setConfirmandoCancelamento(false)}
                className="text-sm text-muted underline underline-offset-2 hover:text-ink"
              >
                continuar gravando
              </button>
            )}
          </>
        ) : (
          <button
            onClick={() => void startRecording()}
            disabled={!ready}
            className="rounded-lg bg-accent px-5 py-2.5 font-medium text-surface disabled:opacity-40"
          >
            Gravar consulta
          </button>
        )}

        <span className="text-xs text-muted">ou</span>

        <label
          className={`cursor-pointer rounded-lg border border-line px-4 py-2.5 text-sm ${
            ready ? "hover:border-accent" : "pointer-events-none opacity-40"
          }`}
        >
          Enviar arquivo
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg"
            className="hidden"
            disabled={!ready}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void createSessionAndUpload(file);
            }}
          />
        </label>
      </div>

      {!consent && (
        <p className="text-xs text-muted">
          Confirme a ciência do paciente para habilitar a gravação.
        </p>
      )}
      {status !== null && <p className="text-sm text-muted">{status}</p>}
      {error !== null && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
