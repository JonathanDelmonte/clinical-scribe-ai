"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { desenharHelice, duracaoDaConversa, posicaoNaConversa } from "@/lib/helice";

import { ClinicalNote, type NoteDoc } from "./ClinicalNote";
import { FichaDeEstado } from "./FichaDeEstado";
import { Helice, LegendaDaHelice } from "./Helice";
import { IconeCheck, IconeExportar } from "./Icones";
import { SessionObjectives, type ObjectiveDoc } from "./SessionObjectives";
import { SegundoMicrofone } from "./SegundoMicrofone";
import { SessionProgress } from "./SessionProgress";
import { TrechoEditavel } from "./TrechoEditavel";
import { SpeakerRoles, type Assignment } from "./SpeakerRoles";

interface Segment {
  id: string;
  speakerLabel: string;
  role: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
  textOriginal?: string | null;
  roleOriginal?: string | null;
  correctedAt?: string | null;
}

interface SessionData {
  session: {
    id: string;
    status: string;
    durationMs: number | null;
    engineChoice: string | null;
    engineUsed: string | null;
    objectiveText: string | null;
    failureReason: string | null;
    progressPercent: number | null;
    progressPhase: string | null;
    progressEtaSeconds: number | null;
    progressPreview: string | null;
    roleAssignment: Assignment[] | null;
    /** O segundo microfone — `jsonb`, lido com conferência no componente. */
    channelDiarization: unknown;
  };
  patient: { name: string } | null;
  segments: Segment[];
  note: NoteDoc | null;
  noteJob: { status: string; error: string | null } | null;
  objectives: ObjectiveDoc[];
  objectiveJob: { status: string; error: string | null } | null;
}

/** Estados em que ainda há trabalho acontecendo no worker. */
const IN_PROGRESS = new Set(["uploaded", "transcribing", "generating"]);
const JOB_ATIVO = new Set(["pending", "running"]);

function timestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [gerando, setGerando] = useState(false);
  const [erroNota, setErroNota] = useState<string | null>(null);

  /**
   * O agradecimento depois de uma correção.
   *
   * Some sozinho: ele existe para o instante seguinte ao clique. Um aviso de
   * sucesso que fica para sempre vira parte do cenário e deixa de ser lido
   * justamente na próxima vez, que é quando precisaria ser.
   */
  const [avisoCorrecao, setAvisoCorrecao] = useState<string | null>(null);

  useEffect(() => {
    if (avisoCorrecao === null) return;
    const id = setTimeout(() => setAvisoCorrecao(null), 5000);
    return () => clearTimeout(id);
  }, [avisoCorrecao]);

  /** Trechos que sustentam a afirmação clicada agora. */
  const [fontesAtivas, setFontesAtivas] = useState<Set<string>>(new Set());

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Segundo em que a reprodução do trecho citado deve parar sozinha. */
  const pararEmRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
        if (!res.ok) throw new Error("sessão não encontrada");
        const body = (await res.json()) as SessionData;
        if (!alive) return;
        setData(body);
        setError(null);

        // Continua pedindo enquanto o worker trabalha. O status da sessão não
        // basta: entre enfileirar a nota e o worker pegá-la, a sessão ainda
        // marca "pronta para revisão". Sem olhar o job, a nota só apareceria
        // quando alguém recarregasse a página.
        const trabalhando =
          IN_PROGRESS.has(body.session.status) ||
          (body.noteJob !== null && JOB_ATIVO.has(body.noteJob.status)) ||
          (body.objectiveJob !== null && JOB_ATIVO.has(body.objectiveJob.status));

        if (trabalhando) {
          timer = setTimeout(() => void poll(), 1500);
        } else {
          setGerando(false);
        }
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "erro");
        timer = setTimeout(() => void poll(), 5000);
      }
    }

    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [sessionId, recarga]);

  /**
   * Toca só o trecho citado, e para sozinho no fim dele.
   *
   * Deixar o áudio correndo depois do trecho obrigaria o profissional a pausar
   * à mão a cada citação conferida. Numa nota com quinze afirmações isso são
   * quinze interrupções — e esse atrito é o que faz a revisão deixar de
   * acontecer.
   */
  const ouvir = useCallback(
    (sources: string[]) => {
      if (data === null || sources.length === 0) return;

      const citados = data.segments.filter((s) => sources.includes(s.id));
      if (citados.length === 0) return;

      setFontesAtivas(new Set(sources));

      const inicio = Math.min(...citados.map((s) => s.startMs));
      const fim = Math.max(...citados.map((s) => s.endMs));

      const audio = audioRef.current;
      if (audio !== null) {
        pararEmRef.current = fim / 1000;
        audio.currentTime = inicio / 1000;
        void audio.play().catch(() => {
          // Autoplay bloqueado, ou formato que o navegador não decodifica. O
          // destaque visual do trecho continua valendo — a revisão não depende
          // do som para acontecer, só fica mais lenta.
        });
      }

      const primeiro = citados[0];
      if (primeiro !== undefined) {
        document
          .getElementById(`trecho-${primeiro.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    [data],
  );

  async function gerarNota() {
    setGerando(true);
    setErroNota(null);
    const res = await fetch(`/api/sessions/${sessionId}/note`, { method: "POST" });
    if (!res.ok) {
      const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
      setErroNota(corpo?.error ?? "não foi possível gerar a nota");
      setGerando(false);
      return;
    }
    setRecarga((n) => n + 1);
  }

  if (error !== null && data === null) {
    return <p className="alerta alerta-erro">{error}</p>;
  }
  if (data === null) {
    return <p className="legenda">carregando…</p>;
  }

  const { session, segments, note, noteJob, objectives, objectiveJob } = data;
  const working = IN_PROGRESS.has(session.status);
  const notaEmAndamento =
    gerando || (noteJob !== null && JOB_ATIVO.has(noteJob.status));
  const speakers = [...new Set(segments.map((s) => s.speakerLabel))];
  const idsValidos = new Set(segments.map((s) => s.id));
  const temProfissional = segments.some((s) => s.role === "professional");

  // ---- a hélice: o desenho, as frases citadas e o trecho em destaque ------
  const inicioDoTrecho = new Map(segments.map((s) => [s.id, s.startMs]));
  const total = duracaoDaConversa(segments);
  const desenho = desenharHelice(segments);
  const inicioDe = (fontes: Iterable<string>): number | null => {
    let menor = Number.POSITIVE_INFINITY;
    for (const f of fontes) menor = Math.min(menor, inicioDoTrecho.get(f) ?? Infinity);
    return Number.isFinite(menor) ? menor : null;
  };
  const contas = (note?.content.sections ?? [])
    .flatMap((secao) => secao.statements)
    .map((afirmacao) => inicioDe(afirmacao.sources))
    .filter((ms): ms is number => ms !== null)
    .map((ms) => posicaoNaConversa(ms, total));
  const inicioAtivo = inicioDe(fontesAtivas);
  const marcador =
    inicioAtivo === null
      ? null
      : {
          posicao: posicaoNaConversa(inicioAtivo, total),
          rotulo: timestamp(inicioAtivo),
        };

  return (
    <div className="flex flex-col gap-6">
      {/*
       * O agradecimento fica FIXO no rodapé, e não ao lado do trecho.
       *
       * Quem corrige está lendo a transcrição, que é longa: o trecho
       * consertado pode estar em qualquer altura da página, e um aviso ali
       * pode nascer fora do campo de visão. No rodapé ele aparece sempre.
       */}
      {avisoCorrecao !== null && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-28 z-50 mx-auto flex max-w-md gap-3 rounded-3xl bg-tinta px-5 py-4 text-sm text-perola shadow-[0_24px_50px_-20px_rgb(15_27_36/0.6)] sm:inset-x-auto sm:right-6 sm:left-auto lg:bottom-6"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-menta text-tinta">
            <IconeCheck tamanho={16} traco={2.4} />
          </span>
          <span>
            <strong className="font-semibold">{avisoCorrecao}</strong>
            <span className="mt-0.5 block text-[13px] text-perola/80">
              Guardamos o que a máquina tinha entendido junto com a sua correção. É
              assim que o reconhecimento e a separação de vozes melhoram.
            </span>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FichaDeEstado status={session.status} />
        {session.durationMs !== null && (
          <span className="text-[14.5px] text-grafite">
            {Math.max(1, Math.round(session.durationMs / 60_000))} min de áudio
          </span>
        )}
        {session.engineUsed !== null && (
          <span className="legenda">
            motor {session.engineUsed}
            {session.engineChoice !== null &&
              session.engineChoice !== session.engineUsed && (
                <> · pedido {session.engineChoice}, descartado</>
              )}
          </span>
        )}
        {(session.status === "ready_for_review" || session.status === "approved") && (
          <Link
            href={`/exportar/${session.id}`}
            className="botao-vidro botao-pequeno ml-auto"
          >
            <IconeExportar tamanho={18} />
            Exportar
          </Link>
        )}
      </div>

      {session.objectiveText !== null && (
        <p className="alerta alerta-info">
          <span className="font-semibold text-tinta">Pedido desta consulta: </span>
          {session.objectiveText}
        </p>
      )}

      {session.failureReason !== null && (
        <p role="alert" className="alerta alerta-erro">
          {session.failureReason}
        </p>
      )}

      {working && (
        <SessionProgress
          data={{
            percent: session.progressPercent,
            phase: session.progressPhase,
            etaSeconds: session.progressEtaSeconds,
            preview: session.progressPreview,
            status: session.status,
          }}
        />
      )}

      {desenho !== null && !working && (
        <section
          aria-labelledby="titulo-helice"
          className="vidro rounded-[26px] px-5 pt-5 pb-4 sm:px-6"
        >
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 id="titulo-helice" className="titulo-secao">
              Quem falou, e quando
            </h2>
            <LegendaDaHelice />
          </div>
          <Helice
            desenho={desenho}
            contas={contas}
            marcador={marcador}
            className="mt-7 h-[72px]"
            rotulo="Hélice da conversa: a fita turquesa engrossa quando você fala, a pêssego quando o paciente fala. As contas marcam os momentos citados pela nota."
          />
          <div className="mt-2 flex justify-between text-[12.5px] text-nevoa tabular-nums">
            <span>00:00</span>
            <span>{timestamp(total)}</span>
          </div>
        </section>
      )}

      {/*
       * Um <audio> só, escondido, controlado por código.
       *
       * Os controles nativos não aparecem porque a unidade de escuta aqui não é
       * "o áudio da consulta" — é "o trecho que sustenta esta frase". Uma barra
       * de 11 minutos ao lado convidaria a procurar o momento à mão, que é
       * exatamente o trabalho que a citação existe para eliminar.
       */}
      <audio
        ref={audioRef}
        src={`/api/sessions/${sessionId}/audio`}
        preload="metadata"
        onTimeUpdate={(e) => {
          const limite = pararEmRef.current;
          if (limite !== null && e.currentTarget.currentTime >= limite) {
            e.currentTarget.pause();
            pararEmRef.current = null;
          }
        }}
        className="hidden"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {note !== null && (
            <ClinicalNote
              key={note.id}
              note={note}
              sessionId={sessionId}
              validSegmentIds={idsValidos}
              activeSources={fontesAtivas}
              onCite={ouvir}
              tempoDe={(fontes) => {
                const ms = inicioDe(fontes);
                return ms === null ? null : timestamp(ms);
              }}
              onSaved={() => setRecarga((n) => n + 1)}
            />
          )}

          {segments.length > 0 && !working && note?.approvedAt == null && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void gerarNota()}
                disabled={notaEmAndamento || !temProfissional}
                className={note === null ? "botao-principal" : "botao-vidro"}
              >
                {notaEmAndamento
                  ? "Escrevendo a nota…"
                  : note !== null
                    ? "Escrever a nota de novo"
                    : "Escrever a nota clínica"}
              </button>

              {!temProfissional && (
                <span className="legenda">
                  confirme quem é o profissional antes de gerar
                </span>
              )}
              {note !== null && !notaEmAndamento && (
                <span className="legenda">a nota atual fica no histórico</span>
              )}
            </div>
          )}

          {erroNota !== null && (
            <p role="alert" className="alerta alerta-erro">
              {erroNota}
            </p>
          )}
          {noteJob?.status === "failed" && noteJob.error !== null && (
            <p role="alert" className="alerta alerta-erro">
              A geração da nota falhou: {noteJob.error}
            </p>
          )}

          {segments.length > 0 && !working && (
            <SessionObjectives
              sessionId={sessionId}
              documents={objectives ?? []}
              working={objectiveJob !== null && JOB_ATIVO.has(objectiveJob.status)}
              canGenerate={temProfissional}
              validSegmentIds={idsValidos}
              activeSources={fontesAtivas}
              onCite={ouvir}
              onQueued={() => setRecarga((n) => n + 1)}
            />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-5">
          {session.roleAssignment !== null && session.roleAssignment.length > 0 && (
            <SpeakerRoles
              sessionId={session.id}
              assignment={session.roleAssignment}
              onChanged={() => setRecarga((n) => n + 1)}
            />
          )}

          {/*
           * Logo abaixo de "Quem é quem", porque responde à mesma pergunta — e é
           * para onde o olho vai quando a separação por voz errou.
           */}
          {segments.length > 0 && !working && (
            <SegundoMicrofone
              sessionId={session.id}
              estadoGravado={session.channelDiarization}
              bloqueio={
                note?.approvedAt != null
                  ? "A nota desta consulta já foi aprovada: quem falou não muda depois da assinatura."
                  : null
              }
              notaGeradaEm={note?.createdAt ?? null}
              onAplicado={() => setRecarga((n) => n + 1)}
            />
          )}

          {segments.length > 0 && (
            <section
              aria-labelledby="titulo-conversa"
              className="vidro flex flex-col gap-3 rounded-[26px] px-3 pt-5 pb-3"
            >
              <div className="flex flex-col gap-0.5 px-3">
                <h2 id="titulo-conversa" className="titulo-secao">
                  Na conversa
                </h2>
                <span className="legenda">
                  {segments.length} trechos · {speakers.length}{" "}
                  {speakers.length === 1 ? "voz" : "vozes"} · toque num trecho para
                  corrigir
                </span>
              </div>

              {speakers.length === 1 && (
                <p className="alerta alerta-aviso mx-2 text-[13px]">
                  Um único falante detectado. A separação de vozes depende do pyannote,
                  que exige um token do Hugging Face. Sem ele, o serviço transcreve
                  normalmente e rotula tudo como{" "}
                  <code className="text-tinta">SPEAKER_00</code>.
                </p>
              )}

              <ol className="flex flex-col gap-1 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">
                {segments.map((s) => (
                  <TrechoEditavel
                    key={s.id}
                    sessionId={sessionId}
                    trecho={s}
                    destacado={fontesAtivas.has(s.id)}
                    timestamp={timestamp(s.startMs)}
                    onOuvir={() => ouvir([s.id])}
                    onCorrigido={(msg) => {
                      setAvisoCorrecao(msg);
                      setRecarga((n) => n + 1);
                    }}
                  />
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
