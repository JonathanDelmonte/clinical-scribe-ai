"use client";

import { useEffect, useState } from "react";

import { nomeDaVoz } from "@/lib/vozes";

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
  const [erro, setErro] = useState<string | null>(null);
  const [trocado, setTrocado] = useState(false);

  /**
   * A confirmação some sozinha.
   *
   * Ela existe para o instante seguinte ao clique, e um aviso de sucesso que
   * fica para sempre vira parte do cenário — deixa de ser lido no clique
   * seguinte, que é justamente quando precisa ser.
   */
  useEffect(() => {
    if (!trocado) return;
    const id = setTimeout(() => setTrocado(false), 6000);
    return () => clearTimeout(id);
  }, [trocado]);

  const profissional = assignment.find((a) => a.role === "professional");
  const indefinido = assignment.every((a) => a.role === "unknown");
  const confianca = profissional?.confidence ?? 0;
  const baixa = confianca < 0.5;

  async function inverter() {
    setBusy(true);
    setErro(null);
    setTrocado(false);

    try {
      const resposta = await fetch(`/api/sessions/${sessionId}/roles`, {
        method: "POST",
      });

      /**
       * A resposta é conferida, e não descartada.
       *
       * Antes esta função chamava a rota, ignorava o que voltava e recarregava
       * de qualquer jeito. Uma falha — sessão sem papéis, sessão de outra
       * pessoa, sessão que expirou — produzia exatamente a mesma tela que um
       * acerto: nenhuma mudança e nenhuma explicação. "Cliquei e não aconteceu
       * nada" era literal, e não havia como a pessoa saber de que lado estava
       * o problema.
       */
      if (!resposta.ok) {
        const corpo: unknown = await resposta.json().catch(() => null);
        setErro(
          typeof corpo === "object" && corpo !== null && "error" in corpo
            ? String((corpo as { error: unknown }).error)
            : "não foi possível trocar os papéis",
        );
        return;
      }

      setTrocado(true);
      onChanged();
    } catch {
      setErro("sem resposta do servidor — confira a conexão e tente de novo");
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
                .map((a, i) => (
                  <span key={a.speakerLabel} title={a.speakerLabel}>
                    {i > 0 && <span className="text-muted"> · </span>}
                    {nomeDaVoz(a.speakerLabel)} ={" "}
                    <strong className="font-medium">
                      {ROLE_LABEL[a.role] ?? a.role}
                    </strong>
                  </span>
                ))}
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

      {/*
       * A confirmação diz ONDE a mudança aconteceu.
       *
       * O efeito real da troca é a transcrição inteira sendo reetiquetada, e
       * ela fica vários rolares abaixo daqui — depois da nota clínica. Sem
       * esta linha, tudo o que o clique produzia no campo de visão era duas
       * palavras trocando de lugar, e quem clicava concluía, com razão, que
       * não tinha acontecido nada.
       */}
      {trocado && (
        <p className="mt-2 text-xs text-accent">
          Pronto — os papéis foram trocados, e a transcrição inteira foi reetiquetada.
        </p>
      )}

      {erro !== null && (
        <p role="alert" className="mt-2 text-xs text-red-500">
          {erro}
        </p>
      )}

      {aberto && profissional !== undefined && (
        <div className="mt-3 border-t border-line pt-3">
          {/*
           * "O que a identificação automática encontrou" — e não "por que a
           * atribuição atual está certa".
           *
           * A distinção importa depois de uma troca manual: as evidências
           * continuam grudadas na voz, não no papel, então o painel passaria a
           * argumentar a favor do contrário do que está gravado. Descrevendo o
           * que ele de fato é — a leitura do classificador —, ele continua
           * verdadeiro com ou sem correção humana por cima.
           */}
          <p className="mb-2 text-xs text-muted">
            O que a identificação automática encontrou na fala de{" "}
            {nomeDaVoz(profissional.speakerLabel)}:
          </p>
          <ul className="space-y-1.5">
            {(profissional.evidence ?? []).map((e, i) => (
              <li key={i} className="text-xs">
                <span className="text-accent">{e.signal}</span>
                <span className="text-muted"> — “{e.excerpt}”</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
