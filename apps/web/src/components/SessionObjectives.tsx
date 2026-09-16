"use client";

import { OBJETIVOS_GLOBAIS } from "@scribe/core";
import { useState } from "react";

export interface ObjectiveItem {
  path: string;
  text: string;
  sources: string[];
  gaps: string[];
}

export interface ObjectiveDoc {
  id: string;
  type: string;
  content: {
    objectiveSlug?: string;
    title?: string;
    items?: ObjectiveItem[];
    dataPolicy?: "training" | "contractual";
  };
  model: string | null;
  createdAt: string;
}

interface Props {
  sessionId: string;
  documents: ObjectiveDoc[];
  working: boolean;
  canGenerate: boolean;
  validSegmentIds: Set<string>;
  activeSources: Set<string>;
  onCite: (sources: string[]) => void;
  onQueued: () => void;
}

/**
 * Objetivo da sessão — o que o profissional pede ALÉM da nota.
 *
 * A §5.3 da documentação chama de biblioteca de objetivos, e é o que separa
 * este produto de um transcritor: a nota registra a consulta, o objetivo
 * entrega o trabalho que sobraria para depois dela.
 */
export function SessionObjectives({
  sessionId,
  documents,
  working,
  canGenerate,
  validSegmentIds,
  activeSources,
  onCite,
  onQueued,
}: Props) {
  const [erro, setErro] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState<string | null>(null);

  async function gerar(slug: string) {
    setPedindo(slug);
    setErro(null);
    const res = await fetch(`/api/sessions/${sessionId}/objective`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    setPedindo(null);
    if (!res.ok) {
      const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
      setErro(corpo?.error ?? "não foi possível gerar");
      return;
    }
    onQueued();
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xs font-medium tracking-widest text-muted uppercase">
        Objetivo da sessão
      </h2>

      {canGenerate && (
        <div className="flex flex-wrap gap-2">
          {OBJETIVOS_GLOBAIS.map((o) => (
            <button
              key={o.slug}
              onClick={() => void gerar(o.slug)}
              disabled={working || pedindo !== null}
              className="rounded-lg border border-line px-4 py-2 text-sm hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {pedindo === o.slug ? "pedindo…" : o.name}
            </button>
          ))}
        </div>
      )}

      {erro !== null && (
        <p role="alert" className="text-sm text-red-500">
          {erro}
        </p>
      )}

      {documents.map((doc) => {
        const itens = doc.content.items ?? [];
        const comLacuna = itens.filter((i) => i.gaps.length > 0);

        return (
          <div key={doc.id} className="rounded-lg border border-line px-5 py-4">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-medium">{doc.content.title ?? doc.type}</h3>
              <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                rascunho
              </span>
              <span className="text-xs text-muted">{doc.model ?? "?"}</span>
            </div>

            {/*
             * O aviso das lacunas, em destaque e antes do conteúdo.
             *
             * Uma receita com três lacunas não é uma receita ruim: é uma
             * receita que precisa de três decisões do profissional antes de
             * existir. Dizer isso na cara é o que impede que ela seja tratada
             * como pronta — que é exatamente o erro que o preenchimento
             * automático causaria.
             */}
            {comLacuna.length > 0 && (
              <p className="mb-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                <strong>
                  {comLacuna.length}{" "}
                  {comLacuna.length === 1 ? "item incompleto" : "itens incompletos"}.
                </strong>{" "}
                O que falta não foi dito na consulta, e o sistema não completa por conta
                própria. Preencha antes de usar.
              </p>
            )}

            {itens.length === 0 ? (
              <p className="text-sm text-muted">
                Nada nesta consulta sustenta este documento. Documento vazio é a
                resposta correta quando não houve o que registrar.
              </p>
            ) : (
              <ul className="space-y-2">
                {itens.map((item) => {
                  const invalidas = item.sources.filter((s) => !validSegmentIds.has(s));
                  const semAncora = item.sources.length === 0 || invalidas.length > 0;
                  const ativa =
                    item.sources.length > 0 &&
                    item.sources.every((s) => activeSources.has(s));

                  return (
                    <li
                      key={item.path}
                      className={`rounded-md px-3 py-2 text-sm ${
                        semAncora
                          ? "bg-red-500/10"
                          : ativa
                            ? "bg-accent/15"
                            : "hover:bg-accent/5"
                      }`}
                    >
                      <button
                        onClick={() => onCite(item.sources)}
                        disabled={item.sources.length === 0}
                        className={`w-full text-left ${
                          semAncora
                            ? "text-red-600 dark:text-red-400"
                            : "cursor-pointer"
                        }`}
                      >
                        {item.text}
                      </button>

                      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
                        {semAncora ? (
                          <span className="font-medium text-red-600 dark:text-red-400">
                            ⚠ sem âncora no áudio
                          </span>
                        ) : (
                          <span className="text-muted">
                            ▸ ouvir {item.sources.length}{" "}
                            {item.sources.length === 1 ? "trecho" : "trechos"}
                          </span>
                        )}

                        {item.gaps.length > 0 && (
                          <span className="text-amber-600 dark:text-amber-400">
                            falta: {item.gaps.join(" · ")}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
