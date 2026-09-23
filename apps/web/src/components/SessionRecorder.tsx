"use client";

import { prepareForUpload } from "@scribe/audio-browser";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { LiveDraft } from "./LiveDraft";
import {
  ACCEPT_DE_AUDIO,
  EXTENSOES_ACEITAS,
  extensaoDoNome,
  MAX_AUDIO_BYTES,
} from "@/lib/audio";
import {
  CONSENT_METHOD_LABEL,
  CONSENT_METHODS,
  textoParaExibicao,
  type ConsentMethod,
} from "@/lib/consent";
import {
  bufferDisponivel,
  descartarGravacao,
  gravarPedaco,
  iniciarGravacao,
  limparAntigas,
  listarPendentes,
  montarGravacao,
  type GravacaoPendente,
} from "@/lib/recording/buffer";
import {
  bateria,
  BATERIA_BAIXA,
  manterTelaAcesa,
  permissaoDeMicrofone,
  vigiarMicrofone,
} from "@/lib/recording/dispositivo";
import { enviarEmPartes, finalizarEnvio } from "@/lib/recording/enviar";
import { useLiveDraft } from "@/lib/useLiveDraft";

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

/**
 * Pedaços de 5 segundos.
 *
 * O valor decide quanto se perde no pior caso — o que ainda não foi entregue
 * ao `ondataavailable` quando a aba morre. Um segundo perderia menos e
 * escreveria no IndexedDB sessenta vezes por minuto durante uma hora, o que em
 * celular antigo compete com a própria gravação. Cinco segundos é a troca:
 * doze escritas por minuto, cinco segundos de risco.
 */
const INTERVALO_DE_PEDACO_MS = 5000;

export function SessionRecorder({
  patientId,
  patientName,
  canChooseEngine,
  defaultEngine,
  minutosRestantes,
}: {
  patientId: string;
  patientName: string;
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
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendentes, setPendentes] = useState<GravacaoPendente[]>([]);
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const indiceRef = useRef(0);
  const soltarTelaRef = useRef<(() => void) | null>(null);
  const pararVigiaRef = useRef<(() => void) | null>(null);
  /**
   * Se o `onstop` que vem a seguir deve descartar em vez de enviar.
   *
   * Um ref, e não estado: `onstop` é um retorno de chamada preso ao
   * MediaRecorder na hora em que ele foi criado, e leria o estado congelado
   * daquele instante. Aqui a diferença entre ler o valor velho e o novo é
   * enviar uma gravação que a pessoa mandou descartar.
   */
  const descartarRef = useRef(false);
  /**
   * As escritas no IndexedDB, em fila.
   *
   * `ondataavailable` não espera: dois pedaços que chegam perto abririam duas
   * transações ao mesmo tempo, e a segunda leria o contador antes de a
   * primeira gravar. Encadear as promessas serializa sem bloquear o callback,
   * que precisa voltar rápido para não atrapalhar a captura.
   */
  const filaRef = useRef<Promise<void>>(Promise.resolve());

  const recarregarPendentes = useCallback(() => {
    if (!bufferDisponivel()) return;
    void limparAntigas()
      .then(listarPendentes)
      .then(setPendentes)
      .catch(() => setPendentes([]));
  }, []);

  useEffect(() => recarregarPendentes(), [recarregarPendentes]);

  // Soltar o microfone e a trava de tela ao sair da página. Sem isto o
  // indicador de gravação continua aceso no navegador, o que é assustador num
  // app de saúde — e é a reclamação certa.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      soltarTelaRef.current?.();
      pararVigiaRef.current?.();
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
   * Continua valendo mesmo com o buffer no dispositivo: o buffer garante que a
   * gravação sobrevive, não que a pessoa vá lembrar de voltar para enviá-la.
   */
  useEffect(() => {
    if (!recording) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [recording]);

  /** Confere o que o aparelho pode atrapalhar, antes de a consulta começar. */
  async function conferirDispositivo(): Promise<string | null> {
    const permissao = await permissaoDeMicrofone();
    if (permissao === "negada") {
      return (
        "O microfone está bloqueado para este site. Libere nas permissões do " +
        "navegador — no celular, no cadeado ao lado do endereço."
      );
    }

    const energia = await bateria();
    if (energia !== null && !energia.carregando && energia.nivel < BATERIA_BAIXA) {
      setAviso(
        `Bateria em ${Math.round(energia.nivel * 100)}%. Uma consulta longa pode ` +
          `não caber — vale ligar na tomada antes de começar.`,
      );
    } else if (!bufferDisponivel()) {
      setAviso(
        "Este navegador não permite guardar a gravação no aparelho (janela " +
          "anônima?). Se a aba fechar durante a consulta, a gravação se perde.",
      );
    }

    return null;
  }

  async function startRecording() {
    setError(null);
    setAviso(null);

    const impedimento = await conferirDispositivo();
    if (impedimento !== null) {
      setError(impedimento);
      return;
    }

    setStatus("preparando…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      /**
       * A sessão é criada AGORA, antes de gravar, e não no fim.
       *
       * É o que faz o registro de ciência carimbar o instante em que o
       * paciente foi informado — que é antes da consulta. Criada no fim, a
       * hora do consentimento ficaria deslocada pela duração inteira do
       * atendimento, que é justamente o número que um registro de
       * consentimento precisa acertar.
       */
      const criada = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          objectiveText: objective.trim() === "" ? undefined : objective.trim(),
          engineChoice: engine === "" ? null : engine,
          consentMethod,
        }),
      });

      if (!criada.ok) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setStatus(null);
        setError("não foi possível criar a sessão");
        return;
      }

      const { session } = (await criada.json()) as { session: { id: string } };

      const mimeType = pickMimeType();
      indiceRef.current = 0;

      if (bufferDisponivel()) {
        await iniciarGravacao({
          sessionId: session.id,
          patientId,
          patientName,
          mimeType: mimeType ?? "audio/webm",
          extensao: extensionFor(mimeType),
        }).catch(() => undefined);
      }

      const recorder = new MediaRecorder(
        stream,
        mimeType === undefined ? undefined : { mimeType },
      );

      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        const indice = indiceRef.current++;
        filaRef.current = filaRef.current.then(() =>
          gravarPedaco(session.id, indice, e.data).catch(() => undefined),
        );
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        soltarTelaRef.current?.();
        soltarTelaRef.current = null;
        pararVigiaRef.current?.();
        pararVigiaRef.current = null;

        if (descartarRef.current) {
          descartarRef.current = false;
          void descartarTudo(session.id);
          return;
        }

        void concluir(session.id, mimeType ?? "audio/webm", extensionFor(mimeType));
      };

      pararVigiaRef.current = vigiarMicrofone(stream, () => {
        setAviso(
          "O microfone foi desconectado ou tomado por outro aplicativo. " +
            "Pare a gravação e confira antes de continuar.",
        );
      });

      recorder.start(INTERVALO_DE_PEDACO_MS);
      recorderRef.current = recorder;
      setElapsed(0);
      setRecording(true);
      setStatus(null);

      soltarTelaRef.current = await manterTelaAcesa();

      // Roda em paralelo, no MESMO fluxo de microfone, e sem `await`: o
      // rascunho baixa um modelo na primeira vez, e esperar por ele atrasaria
      // o início da gravação — que é a única coisa aqui que não pode falhar.
      void rascunho.iniciar(stream);
    } catch (err) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStatus(null);
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
    setAviso(null);
    rascunho.parar();
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  async function descartarTudo(sessionId: string) {
    setStatus(null);
    setElapsed(0);
    await filaRef.current.catch(() => undefined);
    await descartarGravacao(sessionId).catch(() => undefined);
    // A sessão vazia também some: ela só existia para carimbar o
    // consentimento de uma consulta que não chegou a ser gravada.
    await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
    recarregarPendentes();
  }

  /**
   * Monta, prepara e envia.
   *
   * É o mesmo caminho para a gravação que acabou de terminar e para a que foi
   * recuperada do aparelho dias depois — e é por isso que ele começa lendo o
   * IndexedDB em vez de receber os pedaços em memória.
   */
  async function concluir(sessionId: string, mimeType: string, extensao: string) {
    setError(null);
    setStatus("juntando a gravação…");

    try {
      await filaRef.current.catch(() => undefined);

      const bruto = await montarGravacao(sessionId, mimeType);
      if (bruto === null || bruto.size === 0) {
        setStatus(null);
        setError("a gravação não foi encontrada no aparelho");
        return;
      }

      // ---- a metade do navegador ------------------------------------------
      //
      // O dispositivo reamostra para 16 kHz mono e corta o silêncio ANTES de
      // enviar. Reamostrar é ganho puro: o Whisper converte para 16 kHz de
      // qualquer jeito, então mandar 48 kHz estéreo é subir seis vezes mais
      // bytes para o servidor descartar cinco sextos.
      //
      // E o ruído da sala — o silêncio entre as falas — nunca sai daqui.
      setStatus("preparando o áudio no seu dispositivo…");

      let envio: Blob = bruto;
      let extensaoFinal = extensao;
      let mapa: { regions: unknown; removedMs: number; durationMs: number } | null =
        null;

      try {
        const arquivo = new File([bruto], `consulta.${extensao}`, { type: mimeType });
        const pronto = await prepareForUpload(arquivo);
        envio = pronto.file;
        extensaoFinal = "wav";
        // `trimmedMs` e não `originalMs`: o que a quota cobra é o que vai ser
        // transcrito, e o silêncio cortado não chega a ser transcrito.
        mapa = {
          regions: pronto.regions,
          removedMs: pronto.removedMs,
          durationMs: pronto.trimmedMs,
        };
      } catch {
        // Codec que o navegador não decodifica, memória insuficiente num
        // celular antigo, AudioContext bloqueado. Enviar o original é a
        // degradação certa: upload maior e processamento mais lento, nunca
        // consulta perdida.
      }

      const bytes = envio.size;
      const total = await enviarEmPartes({
        sessionId,
        arquivo: envio,
        onProgresso: (p) =>
          setStatus(
            `enviando ${p.enviadas} de ${p.total} · ` +
              `${(bytes / 1024 / 1024).toFixed(1)} MB`,
          ),
      });

      setStatus("concluindo…");
      const fim = await finalizarEnvio(sessionId, {
        total,
        extensao: extensaoFinal,
        durationMs: mapa?.durationMs ?? null,
        removedMs: mapa?.removedMs ?? null,
        regions: mapa?.regions ?? null,
      });

      /**
       * Quota estourada (402) não é falha: o áudio FOI guardado no servidor, e
       * a sessão existe com o motivo escrito nela. Tratar como erro aqui daria
       * a impressão de que a consulta se perdeu — o oposto do que aconteceu.
       */
      if (!fim.ok && fim.status !== 402) {
        setStatus(null);
        setError(
          `${fim.erro ?? "falha ao concluir o envio"}. A gravação continua no ` +
            `aparelho — tente enviar de novo.`,
        );
        recarregarPendentes();
        return;
      }

      await descartarGravacao(sessionId).catch(() => undefined);
      router.push(`/sessoes/${sessionId}`);
    } catch (erro) {
      setStatus(null);
      setError(
        `${erro instanceof Error ? erro.message : "falha no envio"}. A gravação ` +
          `continua no aparelho — tente enviar de novo.`,
      );
      recarregarPendentes();
    }
  }

  /**
   * Envia um arquivo que a pessoa escolheu no aparelho.
   *
   * **Em pedaços, pelo mesmo caminho da gravação**, e não num POST de uma
   * viagem só. O envio único parecia o caminho simples para um arquivo que já
   * está em disco, e era — até 10 MB. Acima disso o corpo chega cortado ao
   * servidor, sem erro nenhum, porque o `proxy.ts` faz o Next bufferizar todo
   * corpo de requisição (ver `lib/audio.ts`). Como o WAV preparado ocupa
   * 1,9 MB por minuto, isso é toda consulta com mais de cinco minutos — ou
   * seja, praticamente todas.
   *
   * Em pedaços de 512 KB nenhum corpo chega perto do teto, e vem de brinde o
   * que a gravação já tinha: progresso visível e retomada quando a rede cai.
   */
  async function enviarArquivo(file: File) {
    setError(null);
    setAviso(null);

    // ---- a metade do navegador, ANTES de criar qualquer coisa -----------
    //
    // A ordem importa: preparar primeiro é o que permite conferir o formato
    // do que vai realmente subir, e recusar um arquivo impossível sem ter
    // deixado uma sessão vazia na pasta do paciente.
    setStatus("preparando o áudio no seu dispositivo…");

    let envio: Blob = file;
    let extensao = extensaoDoNome(file.name);
    let mapa: { regions: unknown; removedMs: number; durationMs: number } | null = null;

    try {
      const pronto = await prepareForUpload(file);
      envio = pronto.file;
      extensao = "wav";
      mapa = {
        regions: pronto.regions,
        removedMs: pronto.removedMs,
        durationMs: pronto.trimmedMs,
      };
    } catch {
      // Codec que o navegador não decodifica, memória insuficiente, contexto
      // de áudio bloqueado. Sobe o original: mais lento, nunca perdido.
    }

    if (!EXTENSOES_ACEITAS.has(extensao)) {
      setStatus(null);
      setError(
        extensao === ""
          ? "não dá para saber o formato deste arquivo — ele precisa ter extensão."
          : `arquivos .${extensao} não são aceitos. ` +
              `Formatos aceitos: ${[...EXTENSOES_ACEITAS].join(", ")}.`,
      );
      return;
    }
    if (envio.size === 0) {
      setStatus(null);
      setError("este arquivo está vazio.");
      return;
    }
    if (envio.size > MAX_AUDIO_BYTES) {
      setStatus(null);
      setError(
        `áudio grande demais (máximo ` +
          `${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB).`,
      );
      return;
    }

    setStatus("criando sessão…");
    const criada = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId,
        objectiveText: objective.trim() === "" ? undefined : objective.trim(),
        engineChoice: engine === "" ? null : engine,
        consentMethod,
      }),
    });

    if (!criada.ok) {
      setStatus(null);
      setError("não foi possível criar a sessão");
      return;
    }

    const { session } = (await criada.json()) as { session: { id: string } };

    try {
      const bytes = envio.size;
      const total = await enviarEmPartes({
        sessionId: session.id,
        arquivo: envio,
        onProgresso: (p) =>
          setStatus(
            `enviando ${p.enviadas} de ${p.total} · ` +
              `${(bytes / 1024 / 1024).toFixed(1)} MB`,
          ),
      });

      setStatus("concluindo…");
      const fim = await finalizarEnvio(session.id, {
        total,
        extensao,
        durationMs: mapa?.durationMs ?? null,
        removedMs: mapa?.removedMs ?? null,
        regions: mapa?.regions ?? null,
      });

      // 402 é quota estourada, e não falha: o áudio está guardado e a sessão
      // existe com o motivo escrito nela. Ver `concluir()`.
      if (!fim.ok && fim.status !== 402) {
        throw new Error(fim.erro ?? "falha ao concluir o envio");
      }

      router.push(`/sessoes/${session.id}`);
    } catch (erro) {
      /**
       * A sessão recém-criada some junto.
       *
       * Ela nunca chegou a ter áudio, e uma sessão vazia na pasta do paciente
       * é pior que nenhuma: parece uma consulta que existiu. O custo é
       * abandonar os pedaços que já subiram — aceitável aqui, e só aqui,
       * porque o arquivo continua inteiro no aparelho da pessoa. É
       * exatamente a diferença entre este caminho e o da gravação, onde a
       * consulta só existe no buffer e a sessão fica de pé para ser retomada.
       */
      await fetch(`/api/sessions/${session.id}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      setStatus(null);
      setError(
        `${erro instanceof Error ? erro.message : "falha no envio"}. O arquivo ` +
          `continua no seu aparelho — pode tentar de novo.`,
      );
    }
  }

  async function reenviarPendente(g: GravacaoPendente) {
    setPendentes([]);
    await concluir(g.sessionId, g.mimeType, g.extensao);
  }

  async function apagarPendente(g: GravacaoPendente) {
    await descartarGravacao(g.sessionId).catch(() => undefined);
    await fetch(`/api/sessions/${g.sessionId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
    recarregarPendentes();
  }

  const busy = status !== null;
  const ready = consent && !busy;

  return (
    <div className="space-y-5">
      {/*
       * Gravações que ficaram no aparelho. Aparecem antes de tudo: quem abre
       * esta tela com uma consulta pendente precisa resolvê-la primeiro, e
       * descobrir isso no fim da página seria descobrir tarde.
       */}
      {pendentes.length > 0 && !recording && (
        <div className="rounded-lg border border-accent bg-accent/5 px-4 py-3">
          <p className="text-sm font-medium">
            {pendentes.length === 1
              ? "Há uma gravação neste aparelho que não chegou a ser enviada."
              : `Há ${pendentes.length} gravações neste aparelho que não chegaram a ser enviadas.`}
          </p>
          <ul className="mt-3 space-y-2">
            {pendentes.map((g) => (
              <li key={g.sessionId} className="flex flex-wrap items-center gap-3">
                <span className="text-sm">
                  {g.patientName} ·{" "}
                  {new Date(g.criadaEm).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
                <button
                  onClick={() => void reenviarPendente(g)}
                  disabled={busy}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-surface disabled:opacity-40"
                >
                  Enviar agora
                </button>
                <button
                  onClick={() => void apagarPendente(g)}
                  disabled={busy}
                  className="text-sm text-muted underline underline-offset-2 hover:text-ink"
                >
                  descartar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
         * O método aparece só depois da confirmação, e é isso que fica gravado
         * na sessão junto com o texto correspondente. Perguntar antes de a
         * pessoa confirmar seria pedir um detalhe sobre algo que ela ainda não
         * disse ter feito.
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
          disabled={busy || recording}
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
            disabled={busy || recording}
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
             * destrutiva não pode disputar atenção com a normal. Quem termina
             * a consulta clica no vermelho sem pensar; quem quer jogar fora
             * procura — e encontra.
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
            accept={ACCEPT_DE_AUDIO}
            className="hidden"
            disabled={!ready}
            onChange={(e) => {
              const file = e.target.files?.[0];
              /**
               * Limpar o campo é o que permite escolher o MESMO arquivo de
               * novo. Sem isto, depois de um envio que falhou, reabrir o
               * seletor e clicar no mesmo arquivo não dispara `change` — e a
               * tela fica sem reagir, que é o jeito mais frustrante possível
               * de um botão estar quebrado.
               */
              e.target.value = "";
              if (file) void enviarArquivo(file);
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
      {aviso !== null && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          {aviso}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
