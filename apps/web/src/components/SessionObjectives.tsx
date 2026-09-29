"use client";

import { OBJETIVOS_GLOBAIS } from "@scribe/core";
import { useState } from "react";

import { IconeAlerta, IconeTocar } from "./Icones";

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
    <section
      aria-labelledby="titulo-objetivos"
      className="vidro flex flex-col gap-4 rounded-[26px] px-4 pt-6 pb-5 sm:px-6"
    >
      <div className="flex flex-col gap-1 px-1">
        <h2 id="titulo-objetivos" className="titulo-secao">
          Além da nota
        </h2>
        <p className="legenda">
          Documentos feitos só com o que foi dito nesta consulta. Toque para pedir.
        </p>
      </div>

      {canGenerate && (
        <div className="flex flex-wrap gap-2 px-1">
          {OBJETIVOS_GLOBAIS.map((o) => (
            <button
              key={o.slug}
              type="button"
              onClick={() => void gerar(o.slug)}
              disabled={working || pedindo !== null}
              className="botao-vidro botao-pequeno"
            >
              {pedindo === o.slug ? "pedindo…" : o.name}
            </button>
          ))}
        </div>
      )}

      {erro !== null && (
        <p role="alert" className="alerta alerta-erro">
          {erro}
        </p>
      )}

      {documents.map((doc) => {
        const itens = doc.content.items ?? [];
        const comLacuna = itens.filter((i) => i.gaps.length > 0);

        return (
          <div
            key={doc.id}
            className="rounded-[20px] border border-white/85 bg-white/55 px-4 py-4"
          >
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-[15.5px] font-semibold">
                {doc.content.title ?? doc.type}
              </h3>
              <span className="ficha ficha-aviso min-h-6 px-2.5 text-[12px]">
                <span aria-hidden="true" className="ficha__ponto" />
                Rascunho
              </span>
              <span className="legenda ml-auto">{doc.model ?? "?"}</span>
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
              <p className="alerta alerta-aviso mb-3">
                <strong className="font-semibold">
                  {comLacuna.length}{" "}
                  {comLacuna.length === 1 ? "item incompleto" : "itens incompletos"}.
                </strong>{" "}
                O que falta não foi dito na consulta, e o sistema não completa por conta
                própria. Preencha antes de usar.
              </p>
            )}

            {itens.length === 0 ? (
              <p className="text-[14.5px] text-grafite">
                Nada nesta consulta sustenta este documento. Documento vazio é a
                resposta correta quando não houve o que registrar.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {itens.map((item) => {
                  const invalidas = item.sources.filter((s) => !validSegmentIds.has(s));
                  const semAncora = item.sources.length === 0 || invalidas.length > 0;
                  const ativa =
                    item.sources.length > 0 &&
                    item.sources.every((s) => activeSources.has(s));

                  return (
                    <li
                      key={item.path}
                      className={`rounded-2xl border px-3 py-2.5 transition-colors ${
                        semAncora
                          ? "border-aviso-ponto/35 bg-[#fff6e3]"
                          : ativa
                            ? "vidro-polido border-white/95"
                            : "border-transparent hover:bg-white/70"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onCite(item.sources)}
                        disabled={item.sources.length === 0}
                        className={`w-full text-left text-[15px] leading-relaxed ${
                          semAncora ? "text-[#5c3e00]" : "cursor-pointer text-tinta"
                        }`}
                      >
                        {item.text}
                      </button>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                        {semAncora ? (
                          <span className="ficha ficha-aviso min-h-6 px-2.5 text-[12px]">
                            <IconeAlerta tamanho={13} traco={2} />
                            sem âncora no áudio
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-viva-texto">
                            <IconeTocar tamanho={11} />
                            ouvir {item.sources.length}{" "}
                            {item.sources.length === 1 ? "trecho" : "trechos"}
                          </span>
                        )}

                        {item.gaps.length > 0 && (
                          <span className="font-medium text-aviso">
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
