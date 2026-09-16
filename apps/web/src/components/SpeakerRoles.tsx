"use client";

import { useState } from "react";

export interface Evidence {
  signal: string;
  excerpt: string;
  weight: number;
}

export interface Assignment {
  speakerLabel: string;
  role: string;
  confidence: number;
  /**
   * Opcional porque vem de uma coluna `jsonb`, e `jsonb` não garante forma.
   *
   * O tipo aqui é uma AFIRMAÇÃO sobre o que está gravado, não uma verificação.
   * Uma linha escrita por uma versão anterior do pipeline, por um seed, ou por
   * qualquer outro processo, satisfaz o banco e quebra a tela. Marcar como
   * opcional faz o compilador cobrar o tratamento em vez de deixar a descoberta
   * para a primeira linha antiga que alguém abrir.
   */
  evidence?: Evidence[];
}

export const ROLE_LABEL: Record<string, string> = {
  professional: "Profissional",
  patient: "Paciente",
  other: "Acompanhante",
  unknown: "Não identificado",
};

/**
 * Quem é quem — e por quê.
 *
 * A evidência fica visível de propósito. A identificação é automática, e o
 * profissional precisa poder conferir o raciocínio antes de confiar nele. É a
 * mesma disciplina das citações da nota: mostrar em que o sistema se baseou,
 * em vez de pedir fé.
 */
export function SpeakerRoles({
  sessionId,
  assignment,
  onChanged,
}: {
  sessionId: string;
  assignment: Assignment[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [aberto, setAberto] = useState(false);

  const profissional = assignment.find((a) => a.role === "professional");
  const indefinido = assignment.every((a) => a.role === "unknown");
  const confianca = profissional?.confidence ?? 0;
  const baixa = confianca < 0.5;

  async function inverter() {
    setBusy(true);
    try {
      await fetch(`/api/sessions/${sessionId}/roles`, { method: "POST" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-xs font-medium tracking-widest text-muted uppercase">
          Quem é quem
        </h2>

        {indefinido ? (
          <span className="text-sm text-amber-500">
            não foi possível identificar — confira a transcrição
          </span>
        ) : (
          <>
            <span className="text-sm">
              {assignment
                .filter((a) => a.role !== "unknown")
                .map((a) => `${a.speakerLabel} = ${ROLE_LABEL[a.role] ?? a.role}`)
                .join(" · ")}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs ${
                baixa ? "bg-amber-500/15 text-amber-500" : "bg-accent/15 text-accent"
              }`}
            >
              {Math.round(confianca * 100)}% de confiança
            </span>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {profissional !== undefined && (profissional.evidence?.length ?? 0) > 0 && (
            <button
              onClick={() => setAberto((v) => !v)}
              className="text-xs text-muted underline underline-offset-2 hover:text-ink"
            >
              {aberto ? "ocultar" : "por quê?"}
            </button>
          )}
          <button
            onClick={() => void inverter()}
            disabled={busy || indefinido}
            className="rounded-md border border-line px-3 py-1 text-xs hover:border-accent disabled:opacity-40"
          >
            {busy ? "trocando…" : "trocar"}
          </button>
        </div>
      </div>

      {baixa && !indefinido && (
        <p className="mt-2 text-xs text-amber-500">
          Confiança baixa. Confira antes de gerar a nota — uma troca invertida
          atribuiria a queixa ao profissional e a conduta ao paciente.
        </p>
      )}

      {aberto && profissional !== undefined && (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
          {(profissional.evidence ?? []).map((e, i) => (
            <li key={i} className="text-xs">
              <span className="text-accent">{e.signal}</span>
              <span className="text-muted"> — “{e.excerpt}”</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
