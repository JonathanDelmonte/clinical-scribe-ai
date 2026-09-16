"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ClinicalNote, type NoteDoc } from "./ClinicalNote";
import { SessionProgress } from "./SessionProgress";
import { ROLE_LABEL, SpeakerRoles, type Assignment } from "./SpeakerRoles";

interface Segment {
  id: string;
  speakerLabel: string;
  role: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
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
  };
  patient: { name: string } | null;
  segments: Segment[];
  note: NoteDoc | null;
  noteJob: { status: string; error: string | null } | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "rascunho",
  recording: "gravando",
  uploaded: "na fila",
  transcribing: "transcrevendo",
  generating: "gerando nota",
  ready_for_review: "pronta para revisão",
  approved: "aprovada",
  failed: "falhou",
};

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
          (body.noteJob !== null && JOB_ATIVO.has(body.noteJob.status));

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
    return <p className="text-sm text-red-500">{error}</p>;
  }
  if (data === null) {
    return <p className="text-sm text-muted">carregando…</p>;
  }

  const { session, segments, note, noteJob } = data;
  const working = IN_PROGRESS.has(session.status);
  const notaEmAndamento =
    gerando || (noteJob !== null && JOB_ATIVO.has(noteJob.status));
  const speakers = [...new Set(segments.map((s) => s.speakerLabel))];
  const idsValidos = new Set(segments.map((s) => s.id));
  const temProfissional = segments.some((s) => s.role === "professional");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span
          className={`inline-flex items-center gap-2 rounded px-2.5 py-1 ${
            session.status === "failed"
              ? "bg-red-500/15 text-red-500"
              : working
                ? "bg-accent/10 text-accent"
                : "bg-accent/15 text-accent"
          }`}
        >
          {working && <span className="size-2 animate-pulse rounded-full bg-current" />}
          {STATUS_LABEL[session.status] ?? session.status}
        </span>
        {session.engineUsed !== null && (
          <span className="text-muted">
            motor <strong className="text-ink">{session.engineUsed}</strong>
            {session.engineChoice !== null &&
              session.engineChoice !== session.engineUsed && (
                <> · pedido {session.engineChoice}, descartado</>
              )}
          </span>
        )}
        {session.durationMs !== null && (
          <span className="text-muted">
            {(session.durationMs / 60_000).toFixed(1)} min de áudio
          </span>
        )}
      </div>

      {session.objectiveText !== null && (
        <p className="rounded-lg border border-line px-4 py-3 text-sm">
          <span className="text-muted">objetivo: </span>
          {session.objectiveText}
        </p>
      )}

      {session.failureReason !== null && (
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-500"
        >
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

      {session.roleAssignment !== null && session.roleAssignment.length > 0 && (
        <SpeakerRoles
          sessionId={session.id}
          assignment={session.roleAssignment}
          onChanged={() => setRecarga((n) => n + 1)}
        />
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

      {note !== null && (
        <ClinicalNote
          note={note}
          validSegmentIds={idsValidos}
          activeSources={fontesAtivas}
          onCite={ouvir}
        />
      )}

      {segments.length > 0 && !working && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => void gerarNota()}
            disabled={notaEmAndamento || !temProfissional}
            className="rounded-lg bg-accent px-5 py-2.5 font-medium text-surface disabled:opacity-40"
          >
            {notaEmAndamento
              ? "Gerando nota…"
              : note !== null
                ? "Gerar nota de novo"
                : "Gerar nota clínica"}
          </button>

          {!temProfissional && (
            <span className="text-xs text-muted">
              confirme quem é o profissional antes de gerar
            </span>
          )}
          {note !== null && !notaEmAndamento && (
            <span className="text-xs text-muted">a nota atual fica no histórico</span>
          )}
        </div>
      )}

      {erroNota !== null && (
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-500"
        >
          {erroNota}
        </p>
      )}
      {noteJob?.status === "failed" && noteJob.error !== null && (
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-500"
        >
          A geração da nota falhou: {noteJob.error}
        </p>
      )}

      {segments.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-medium tracking-widest text-muted uppercase">
            Transcrição · {segments.length} trechos · {speakers.length}{" "}
            {speakers.length === 1 ? "falante" : "falantes"}
          </h2>

          {speakers.length === 1 && (
            <p className="mb-4 rounded-lg border border-line px-4 py-3 text-xs text-muted">
              Um único falante detectado. A separação de vozes depende do pyannote, que
              exige um token do Hugging Face — sem ele o serviço transcreve normalmente
              e rotula tudo como <code className="text-ink">SPEAKER_00</code>.
            </p>
          )}

          <ol className="space-y-1.5">
            {segments.map((s) => {
              const citado = fontesAtivas.has(s.id);
              return (
                <li
                  key={s.id}
                  id={`trecho-${s.id}`}
                  className={`flex gap-3 rounded-md text-sm transition-colors ${
                    citado ? "-mx-2 bg-accent/15 px-2 py-1" : ""
                  }`}
                >
                  <button
                    onClick={() => ouvir([s.id])}
                    title="ouvir este trecho"
                    className="w-12 shrink-0 cursor-pointer text-left font-mono text-xs text-muted tabular-nums hover:text-accent"
                  >
                    {timestamp(s.startMs)}
                  </button>
                  {/*
                   * O PAPEL, não o rótulo acústico. "SPEAKER_01" não diz nada a
                   * um profissional lendo a própria consulta; "Paciente" diz
                   * tudo. O rótulo cru fica como título, para diagnóstico.
                   */}
                  <span
                    title={s.speakerLabel}
                    className={`w-24 shrink-0 text-xs ${
                      s.role === "professional"
                        ? "font-medium text-accent"
                        : s.role === "unknown"
                          ? "text-muted/60 italic"
                          : "text-muted"
                    }`}
                  >
                    {ROLE_LABEL[s.role] ?? s.speakerLabel}
                  </span>
                  <span className="min-w-0">{s.text}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
