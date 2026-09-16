"use client";

import { useEffect, useState } from "react";

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

function timestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("sessão não encontrada");
        const body = (await res.json()) as SessionData;
        if (!alive) return;
        setData(body);
        setError(null);

        // Só continua pedindo enquanto há trabalho em andamento. Um intervalo
        // fixo que nunca para desperdiça consulta ao banco em toda aba aberta
        // e esquecida.
        // 1,5s enquanto processa: a barra precisa se mover de forma visível.
        // Depois de pronta, nada muda e o laço para — aba esquecida aberta não
        // deve consultar o banco para sempre.
        if (IN_PROGRESS.has(body.session.status)) {
          timer = setTimeout(() => void poll(), 1500);
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

  if (error !== null && data === null) {
    return <p className="text-sm text-red-500">{error}</p>;
  }
  if (data === null) {
    return <p className="text-sm text-muted">carregando…</p>;
  }

  const { session, segments } = data;
  const working = IN_PROGRESS.has(session.status);
  const speakers = [...new Set(segments.map((s) => s.speakerLabel))];

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
            {segments.map((s) => (
              <li key={s.id} className="flex gap-3 text-sm">
                <span className="w-12 shrink-0 font-mono text-xs text-muted tabular-nums">
                  {timestamp(s.startMs)}
                </span>
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
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
