"use client";

import { prepareForUpload } from "@scribe/audio-browser";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Atmosfera } from "./Atmosfera";
import {
  IconeAparelho,
  IconeCheck,
  IconeEnviarArquivo,
  IconeMicrofone,
} from "./Icones";
import { LiveDraft } from "./LiveDraft";
import { Orbe, PontoViva } from "./Orbe";
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
import {
  duracaoPelosMetadados,
  esquecerPreparo,
  estadoDoLimite,
  INTERVALO_DE_PEDACO_MS,
  LIMITE_GRAVACAO_S,
  memoriaDoAparelho,
  prepararArquivoNoNavegador,
  prepararGravacaoNoNavegador,
  prepararSemRepetirQueda,
} from "@/lib/recording/limite";
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
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const minutos = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${minutos}` : minutos;
}

/** A chave da marca de preparo de um arquivo escolhido — ver `limite.ts`. */
function chaveDoArquivo(file: File): string {
  return `arquivo:${file.name}:${file.size}:${file.lastModified}`;
}

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
  /** Há pedaços só na memória desta aba — fechá-la agora os perderia. */
  const [soNaMemoria, setSoNaMemoria] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const indiceRef = useRef(0);
  /** `performance.now()` do início da gravação — ver o cronômetro abaixo. */
  const inicioRef = useRef(0);
  /**
   * Os pedaços que o aparelho recusou guardar — pouco espaço livre, banco
   * bloqueado — e que ficam na memória desta aba até o envio.
   *
   * Sem isto, uma escrita recusada no IndexedDB perdia o pedaço em silêncio:
   * cinco segundos de consulta a menos, sem ninguém saber. Numa gravação de
   * horas num celular quase cheio, isso deixa de ser raro.
   */
  const reservaRef = useRef<{
    gravacao: GravacaoPendente;
    pedacos: Map<number, Blob>;
  } | null>(null);
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
    // A gravação que só existe na memória desta aba entra na lista também:
    // sem ela, um envio que falhou não teria botão para tentar de novo.
    const reserva = reservaRef.current;
    const naMemoria =
      reserva !== null && reserva.pedacos.size > 0 ? [reserva.gravacao] : [];
    if (!bufferDisponivel()) {
      setPendentes(naMemoria);
      return;
    }
    void limparAntigas()
      .then(listarPendentes)
      .then((lista) =>
        setPendentes([
          ...naMemoria.filter((g) => !lista.some((l) => l.sessionId === g.sessionId)),
          ...lista,
        ]),
      )
      .catch(() => setPendentes(naMemoria));
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

  /**
   * O cronômetro — pelo relógio, e não somando um a cada segundo.
   *
   * Com a tela apagada ou o navegador em segundo plano, os timers são
   * espaçados (até um por minuto), e a soma ficaria para trás. É esta conta
   * que decide quando a gravação encerra sozinha. `performance.now()` e não
   * `Date.now()`: não pula quando o relógio do aparelho é acertado.
   */
  useEffect(() => {
    if (!recording) return;
    const atualizar = () =>
      setElapsed(Math.floor((performance.now() - inicioRef.current) / 1000));
    const id = setInterval(atualizar, 1000);
    document.addEventListener("visibilitychange", atualizar);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", atualizar);
    };
  }, [recording]);

  /**
   * O limite de três horas. Encerrar é o mesmo que clicar em Parar: tudo o
   * que foi gravado segue para o envio, e nada se perde.
   */
  const limite = estadoDoLimite(elapsed);
  useEffect(() => {
    if (!recording || limite.tipo !== "encerrar") return;
    stopRecording();
    setAviso(
      `A gravação chegou ao limite de ${LIMITE_GRAVACAO_S / 3600} horas e foi ` +
        `encerrada sozinha. Tudo o que foi gravado está sendo enviado.`,
    );
    // `stopRecording` é recriada a cada render; o que importa é o limite.
  }, [recording, limite.tipo]);

  /**
   * Avisa antes de fechar a aba com gravação em andamento — ou com pedaços
   * que só existem na memória dela.
   *
   * Continua valendo mesmo com o buffer no dispositivo: o buffer garante que a
   * gravação sobrevive, não que a pessoa vá lembrar de voltar para enviá-la.
   */
  useEffect(() => {
    if (!recording && !soNaMemoria) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [recording, soNaMemoria]);

  /** Confere o que o aparelho pode atrapalhar, antes de a consulta começar. */
  async function conferirDispositivo(): Promise<string | null> {
    const permissao = await permissaoDeMicrofone();
    if (permissao === "negada") {
      return (
        "O microfone está bloqueado para este site. Libere nas permissões do " +
        "navegador (no celular, no cadeado ao lado do endereço)."
      );
    }

    const energia = await bateria();
    if (energia !== null && !energia.carregando && energia.nivel < BATERIA_BAIXA) {
      setAviso(
        `Bateria em ${Math.round(energia.nivel * 100)}%. Uma consulta longa pode ` +
          `não caber. Vale ligar na tomada antes de começar.`,
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
      reservaRef.current = {
        gravacao: {
          sessionId: session.id,
          patientId,
          patientName,
          criadaEm: Date.now(),
          mimeType: mimeType ?? "audio/webm",
          extensao: extensionFor(mimeType),
          pedacos: 0,
        },
        pedacos: new Map(),
      };

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
        const dados = e.data;
        filaRef.current = filaRef.current.then(() =>
          gravarPedaco(session.id, indice, dados).catch(() =>
            guardarNaMemoria(session.id, indice, dados),
          ),
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

        // O último pedaço chega antes do `onstop`: aqui a contagem está completa.
        const total = indiceRef.current;
        if (reservaRef.current?.gravacao.sessionId === session.id) {
          reservaRef.current.gravacao = {
            ...reservaRef.current.gravacao,
            pedacos: total,
          };
        }
        void concluir(
          session.id,
          mimeType ?? "audio/webm",
          extensionFor(mimeType),
          total,
        );
      };

      pararVigiaRef.current = vigiarMicrofone(stream, () => {
        setAviso(
          "O microfone foi desconectado ou tomado por outro aplicativo. " +
            "Pare a gravação e confira antes de continuar.",
        );
      });

      recorder.start(INTERVALO_DE_PEDACO_MS);
      recorderRef.current = recorder;
      inicioRef.current = performance.now();
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
          ? "Permissão de microfone negada. Libere no navegador e tente de novo."
          : "não foi possível acessar o microfone",
      );
    }
  }

  /** O pedaço que o aparelho recusou guardar fica na memória desta aba. */
  function guardarNaMemoria(sessionId: string, indice: number, dados: Blob) {
    const reserva = reservaRef.current;
    if (reserva === null || reserva.gravacao.sessionId !== sessionId) return;
    reserva.pedacos.set(indice, dados);
    if (reserva.pedacos.size === 1) {
      setSoNaMemoria(true);
      setAviso(
        "O aparelho não conseguiu guardar parte da gravação (pouco espaço livre?). " +
          "Ela continua sendo gravada na memória desta aba. Não feche a aba até " +
          "o envio terminar.",
      );
    }
  }

  /** A gravação saiu do aparelho — enviada ou descartada. Nada fica para trás. */
  function esquecerGravacao(sessionId: string) {
    esquecerPreparo(sessionId);
    if (reservaRef.current?.gravacao.sessionId === sessionId) {
      reservaRef.current = null;
      setSoNaMemoria(false);
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
    esquecerGravacao(sessionId);
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
   *
   * `pedacosGravados` é quantos pedaços a gravação teve — é por ele que se
   * sabe a duração, e se a memória da aba tem a gravação inteira.
   */
  async function concluir(
    sessionId: string,
    mimeType: string,
    extensao: string,
    pedacosGravados: number,
  ) {
    setError(null);
    setStatus("juntando a gravação…");

    try {
      await filaRef.current.catch(() => undefined);

      const reserva =
        reservaRef.current?.gravacao.sessionId === sessionId
          ? reservaRef.current.pedacos
          : undefined;
      const bruto = await montarGravacao(sessionId, mimeType, reserva, pedacosGravados);
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
      // E o ruído da sala — o silêncio entre as falas — não sai daqui. A
      // exceção é a gravação longa demais para preparar sem arriscar a
      // memória do aparelho (ver `limite.ts`): ela sobe como veio.
      let envio: Blob = bruto;
      let extensaoFinal = extensao;
      let mapa: { regions: unknown; removedMs: number; durationMs: number } | null =
        null;

      if (prepararGravacaoNoNavegador(pedacosGravados, memoriaDoAparelho())) {
        setStatus("preparando o áudio no seu dispositivo…");
        try {
          const arquivo = new File([bruto], `consulta.${extensao}`, { type: mimeType });
          const pronto = await prepararSemRepetirQueda(sessionId, () =>
            prepareForUpload(arquivo),
          );
          if (pronto !== null) {
            envio = pronto.file;
            extensaoFinal = "wav";
            // `trimmedMs` e não `originalMs`: o que a quota cobra é o que vai
            // ser transcrito, e o silêncio cortado não chega a ser transcrito.
            mapa = {
              regions: pronto.regions,
              removedMs: pronto.removedMs,
              durationMs: pronto.trimmedMs,
            };
          }
        } catch {
          // Codec que o navegador não decodifica, memória insuficiente num
          // celular antigo, AudioContext bloqueado. Enviar o original é a
          // degradação certa: upload maior e processamento mais lento, nunca
          // consulta perdida.
        }
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
            `aparelho. Tente enviar de novo.`,
        );
        recarregarPendentes();
        return;
      }

      await descartarGravacao(sessionId).catch(() => undefined);
      esquecerGravacao(sessionId);
      router.push(`/sessoes/${sessionId}`);
    } catch (erro) {
      setStatus(null);
      setError(
        `${erro instanceof Error ? erro.message : "falha no envio"}. A gravação ` +
          `continua no aparelho. Tente enviar de novo.`,
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

    // Arquivo longo demais para decodificar sem arriscar a memória do
    // aparelho sobe como veio — ver `limite.ts`.
    const duracaoS = await duracaoPelosMetadados(file);
    if (prepararArquivoNoNavegador(duracaoS, file.size, memoriaDoAparelho())) {
      try {
        const pronto = await prepararSemRepetirQueda(chaveDoArquivo(file), () =>
          prepareForUpload(file),
        );
        if (pronto !== null) {
          envio = pronto.file;
          extensao = "wav";
          mapa = {
            regions: pronto.regions,
            removedMs: pronto.removedMs,
            durationMs: pronto.trimmedMs,
          };
        }
      } catch {
        // Codec que o navegador não decodifica, memória insuficiente, contexto
        // de áudio bloqueado. Sobe o original: mais lento, nunca perdido.
      }
    }

    if (!EXTENSOES_ACEITAS.has(extensao)) {
      setStatus(null);
      setError(
        extensao === ""
          ? "Não dá para saber o formato deste arquivo: ele precisa ter extensão."
          : `Arquivos .${extensao} não são de áudio. Envie a gravação da consulta: ` +
              `MP3, M4A, WAV, AMR, WMA, vídeo do celular e quase qualquer outro formato servem.`,
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

      esquecerPreparo(chaveDoArquivo(file));
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
          `continua no seu aparelho. Pode tentar de novo.`,
      );
    }
  }

  async function reenviarPendente(g: GravacaoPendente) {
    setPendentes([]);
    // O aparelho conta os pedaços que ELE guardou; a memória desta aba, os
    // que ele recusou. A gravação tem o maior dos dois.
    const naMemoria =
      reservaRef.current?.gravacao.sessionId === g.sessionId
        ? reservaRef.current.gravacao.pedacos
        : 0;
    await concluir(g.sessionId, g.mimeType, g.extensao, Math.max(g.pedacos, naMemoria));
  }

  async function apagarPendente(g: GravacaoPendente) {
    await descartarGravacao(g.sessionId).catch(() => undefined);
    esquecerGravacao(g.sessionId);
    await fetch(`/api/sessions/${g.sessionId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
    recarregarPendentes();
  }

  const busy = status !== null;
  const ready = consent && !busy;
  /**
   * O modo foco: a tela inteira durante a gravação e o envio.
   *
   * Enquanto a consulta acontece, o resto do aplicativo sai de cena. Não é
   * estética: um celular na mesa, com a lista de pacientes e dez botões à
   * vista, é um convite a um toque errado no meio da consulta — e a gravação
   * que se perde aconteceu uma vez só.
   */
  const emFoco = recording || busy;

  return (
    <div className="space-y-5">
      {/*
       * Gravações que ficaram no aparelho. Aparecem antes de tudo: quem abre
       * esta tela com uma consulta pendente precisa resolvê-la primeiro, e
       * descobrir isso no fim da página seria descobrir tarde.
       */}
      {pendentes.length > 0 && !recording && (
        <div className="alerta alerta-aviso">
          <p className="font-semibold">
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
                  type="button"
                  onClick={() => void reenviarPendente(g)}
                  disabled={busy}
                  className="botao-principal botao-pequeno"
                >
                  Enviar agora
                </button>
                <button
                  type="button"
                  onClick={() => void apagarPendente(g)}
                  disabled={busy}
                  className="botao-texto"
                >
                  descartar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-[20px] border border-white/85 bg-white/55 px-4 py-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="caixa mt-0.5"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={busy || recording}
          />
          <span className="text-[15px] font-medium">
            O paciente foi informado de que a consulta será gravada.
            <span className="legenda mt-1 block font-normal">
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
          <div className="mt-4 border-t border-line pt-4">
            <label className="block">
              <span className="rotulo">Como foi informado</span>
              <select
                className="campo"
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
            <p className="legenda mt-2">
              Fica registrado nesta sessão: &ldquo;{textoParaExibicao(consentMethod)}
              &rdquo;
            </p>
          </div>
        )}
      </div>

      <label className="block">
        <span className="rotulo">Pedido desta consulta (opcional)</span>
        <input
          className="campo"
          placeholder="ex.: gerar plano alimentar e pontos de acompanhamento"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          disabled={busy || recording}
        />
      </label>

      {canChooseEngine && (
        <label className="block">
          <span className="rotulo">Motor de transcrição</span>
          <select
            className="campo"
            value={engine}
            onChange={(e) => setEngine(e.target.value as Engine | "")}
            disabled={busy || recording}
          >
            <option value="">padrão do plano ({defaultEngine})</option>
            <option value="local">local (Whisper no servidor)</option>
            <option value="cloud">cloud (API comercial)</option>
          </select>
          <span className="legenda mt-1.5 block">
            Disponível porque seu cargo é <code>developer</code>.
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void startRecording()}
          disabled={!ready}
          className="botao-principal"
        >
          Começar a ouvir
          <span className="botao-icone">
            <IconeMicrofone tamanho={19} />
          </span>
        </button>

        <label
          className={`botao-fantasma ${ready ? "" : "pointer-events-none opacity-45"}`}
        >
          <IconeEnviarArquivo tamanho={19} />
          Enviar um áudio
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

      <div className="space-y-2">
        {!consent && (
          <p className="legenda">
            Confirme a ciência do paciente para habilitar a gravação.
          </p>
        )}
        {minutosRestantes !== null && (
          <p
            className={`text-[13px] ${minutosRestantes <= 0 ? "text-erro" : "text-nevoa"}`}
          >
            {minutosRestantes <= 0
              ? "Quota do mês esgotada. A gravação é guardada, mas só será processada no próximo mês ou com outro plano."
              : `Restam ${Math.floor(minutosRestantes)} minutos de processamento neste mês.`}
          </p>
        )}
        {aviso !== null && !emFoco && <p className="alerta alerta-aviso">{aviso}</p>}
        {error !== null && !emFoco && (
          <p role="alert" className="alerta alerta-erro">
            {error}
          </p>
        )}
      </div>

      {/*
       * Num portal, direto no `body`. O cartão de vidro em volta do gravador
       * usa `backdrop-filter`, e isso faz do cartão o referencial de todo
       * `position: fixed` lá dentro: sem o portal, a "tela cheia" ficaria
       * presa ao tamanho do cartão, com a página inteira aparecendo em volta.
       */}
      {emFoco &&
        createPortal(
          <ModoFoco
            paciente={patientName}
            gravando={recording}
            status={status}
            tempo={formatElapsed(elapsed)}
            pedido={objective.trim()}
            guardadoNoAparelho={bufferDisponivel() && !soNaMemoria}
            aviso={aviso}
            erro={error}
            avisoDeLimite={
              recording && limite.tipo === "aviso"
                ? `A gravação chega ao limite de ${LIMITE_GRAVACAO_S / 3600} horas em ${
                    limite.minutosRestantes === 1
                      ? "1 minuto"
                      : `${limite.minutosRestantes} minutos`
                  }. Nesse momento ela é encerrada e enviada sozinha, sem perder nada do que foi gravado.`
                : null
            }
            confirmandoDescarte={confirmandoCancelamento}
            aoEncerrar={stopRecording}
            aoDescartar={cancelRecording}
            aoContinuar={() => setConfirmandoCancelamento(false)}
            rascunho={<LiveDraft estado={rascunho.estado} trechos={rascunho.trechos} />}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * A tela da consulta em andamento — e do envio, logo depois.
 *
 * Um componente à parte para que o gravador continue sendo lido de cima a
 * baixo como lógica. Aqui só há apresentação: tudo o que ele faz chega por
 * propriedade, e nada aqui decide nada sobre a gravação.
 */
function ModoFoco({
  paciente,
  gravando,
  status,
  tempo,
  pedido,
  guardadoNoAparelho,
  aviso,
  erro,
  avisoDeLimite,
  confirmandoDescarte,
  aoEncerrar,
  aoDescartar,
  aoContinuar,
  rascunho,
}: {
  paciente: string;
  gravando: boolean;
  status: string | null;
  tempo: string;
  pedido: string;
  guardadoNoAparelho: boolean;
  aviso: string | null;
  erro: string | null;
  avisoDeLimite: string | null;
  confirmandoDescarte: boolean;
  aoEncerrar: () => void;
  aoDescartar: () => void;
  aoContinuar: () => void;
  rascunho: React.ReactNode;
}) {
  const encerrarRef = useRef<HTMLButtonElement | null>(null);

  // A página de trás não rola enquanto a consulta ocupa a tela: no celular,
  // um dedo apoiado no vidro arrastaria a pasta do paciente por baixo.
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);

  // O foco vai para "Encerrar" ao abrir: quem usa teclado ou leitor de tela
  // cai direto na ação que importa, e não num elemento atrás da cortina.
  useEffect(() => {
    if (gravando) encerrarRef.current?.focus();
  }, [gravando]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modo-foco-titulo"
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-perola"
    >
      <Atmosfera luz="foco" />

      <div className="mx-auto flex min-h-dvh max-w-[1440px] flex-col px-4 pt-4 pb-6 sm:px-8 sm:pt-6">
        <header className="flex items-center justify-between gap-3">
          <span className="hidden items-center gap-2.5 sm:flex">
            <PontoViva tamanho={26} />
            <span className="text-base font-semibold tracking-tight">
              Consulta Viva
            </span>
          </span>
          <span className="vidro-polido flex h-11 min-w-0 items-center gap-2.5 rounded-full pr-4 pl-1.5">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-pessego-claro text-[12px] font-semibold"
            >
              {paciente.trim().charAt(0).toLocaleUpperCase("pt-BR")}
            </span>
            <span className="truncate text-[14.5px] font-semibold">{paciente}</span>
          </span>
          <span
            className={`flex items-center gap-2 text-[13px] ${
              guardadoNoAparelho ? "text-grafite" : "text-aviso"
            }`}
          >
            <IconeAparelho
              tamanho={18}
              className={guardadoNoAparelho ? "text-viva-texto" : "text-aviso"}
            />
            <span className="hidden sm:inline">
              {guardadoNoAparelho ? "Salvo neste aparelho" : "Só na memória desta aba"}
            </span>
          </span>
        </header>

        <div className="flex flex-1 flex-col items-center gap-10 py-8 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:gap-12">
          <div className="order-3 w-full max-w-md justify-self-start lg:order-1">
            {gravando && rascunho}
          </div>

          <div className="order-1 flex flex-col items-center gap-4 lg:order-2">
            <div className="mb-8 sm:mb-10">
              <Orbe
                tamanho={220}
                modo={gravando ? "ouvindo" : "pensando"}
                className="sm:hidden"
              />
              <Orbe
                tamanho={300}
                modo={gravando ? "ouvindo" : "pensando"}
                className="hidden sm:block"
              />
            </div>

            <h2 id="modo-foco-titulo" className="sr-only">
              {gravando
                ? `Consulta de ${paciente} em andamento`
                : "Guardando a consulta"}
            </h2>

            {gravando ? (
              <span className="ficha ficha-gravando">
                <span aria-hidden="true" className="ficha__ponto" />
                Ouvindo
              </span>
            ) : (
              <span className="ficha ficha-processando" role="status">
                <span aria-hidden="true" className="ficha__ponto" />
                {status ?? "Guardando a consulta"}
              </span>
            )}

            <span
              aria-label="Tempo de gravação"
              className="text-[clamp(4rem,3rem+4vw,6.5rem)] leading-none font-light tracking-[-0.04em] tabular-nums"
            >
              {tempo}
            </span>

            {pedido !== "" && (
              <p className="max-w-sm text-center text-[14px] text-grafite">
                Pedido desta consulta: {pedido}
              </p>
            )}
          </div>

          <div className="order-2 flex w-full max-w-md flex-col items-center gap-4 lg:order-3 lg:items-start">
            {avisoDeLimite !== null && (
              <p role="status" className="alerta alerta-aviso">
                {avisoDeLimite}
              </p>
            )}
            {aviso !== null && <p className="alerta alerta-aviso">{aviso}</p>}
            {erro !== null && (
              <p role="alert" className="alerta alerta-erro">
                {erro}
              </p>
            )}

            {gravando ? (
              <>
                <button
                  ref={encerrarRef}
                  type="button"
                  onClick={aoEncerrar}
                  className="botao-principal min-h-[60px] px-7 text-base"
                >
                  Encerrar e escrever a nota
                  <span className="botao-icone size-11">
                    <IconeCheck tamanho={20} traco={2} />
                  </span>
                </button>

                {/*
                 * Descartar fica DEPOIS de encerrar, e discreto.
                 *
                 * São ações opostas com consequências muito diferentes, e a
                 * destrutiva não pode disputar atenção com a normal. Quem termina
                 * a consulta toca no botão escuro sem pensar; quem quer jogar
                 * fora procura — e encontra.
                 */}
                <span className="flex flex-wrap items-center justify-center gap-4">
                  <button
                    type="button"
                    onClick={aoDescartar}
                    className={`botao-texto ${confirmandoDescarte ? "perigo font-semibold" : ""}`}
                  >
                    {confirmandoDescarte
                      ? "Confirmar: apagar esta gravação"
                      : "Descartar gravação"}
                  </button>
                  {confirmandoDescarte && (
                    <button type="button" onClick={aoContinuar} className="botao-texto">
                      Continuar gravando
                    </button>
                  )}
                </span>

                <p className="legenda max-w-xs text-center lg:text-left">
                  {guardadoNoAparelho
                    ? "Pode deixar a tela assim. Se a internet cair, a gravação continua guardada neste aparelho."
                    : "Não feche esta aba: a gravação está só na memória dela até o envio."}
                </p>
              </>
            ) : (
              <p className="legenda max-w-xs text-center lg:text-left">
                Não feche esta aba até o envio terminar. Em seguida a consulta abre para
                você acompanhar a nota sendo escrita.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
