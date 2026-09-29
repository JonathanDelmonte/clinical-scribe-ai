"use client";

import { sectionTitle, type SecaoChave } from "@scribe/core";
import { useState } from "react";

import { IconeAlerta, IconeCheck, IconeTocar } from "./Icones";

export interface NoteStatement {
  path: string;
  text: string;
  sources: string[];
  editedAt?: string;
  confirmedAt?: string;
}

export interface NoteSectionData {
  key: SecaoChave;
  statements: NoteStatement[];
}

export interface NoteDoc {
  id: string;
  content: {
    sections: NoteSectionData[];
    provider?: string;
    dataPolicy?: "training" | "contractual";
  };
  model: string | null;
  promptVersion: string | null;
  citationIssues: { kind: string; path: string; segmentId?: string }[] | null;
  approvedAt: string | null;
  createdAt: string;
}

interface Props {
  note: NoteDoc;
  sessionId: string;
  /** IDs de trechos que existem de verdade — para marcar fonte fabricada. */
  validSegmentIds: Set<string>;
  activeSources: Set<string>;
  onCite: (sources: string[]) => void;
  /** O instante, no áudio, do primeiro trecho citado — "04:12". */
  tempoDe: (sources: string[]) => string | null;
  onSaved: () => void;
}

/** Uma afirmação está sustentada? A mesma regra de `checkApproval`, na tela. */
function sustentada(a: NoteStatement, validos: Set<string>): boolean {
  if (a.confirmedAt !== undefined) return true;
  if (a.sources.length === 0) return false;
  return a.sources.every((f) => validos.has(f));
}

/**
 * A nota clínica: ler, ouvir a fonte, corrigir, e assinar.
 *
 * A conferência determinística já provou que toda fonte citada EXISTE. O que
 * ela não tem como provar é que a fonte SUSTENTA a afirmação — para isso
 * alguém precisa ouvir. Por isso cada afirmação é clicável: o caminho entre
 * ler "dor lombar há três dias" e ouvir o paciente dizer isso precisa ser um
 * toque, não uma busca no áudio.
 *
 * Quando revisar custa caro, ninguém revisa; e uma nota não revisada é
 * exatamente o cenário dos 62% de achados fabricados que passaram (§11).
 */
export function ClinicalNote({
  note,
  sessionId,
  validSegmentIds,
  activeSources,
  onCite,
  tempoDe,
  onSaved,
}: Props) {
  const aprovada = note.approvedAt !== null;

  const [secoes, setSecoes] = useState<NoteSectionData[]>(note.content.sections ?? []);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const todas = secoes.flatMap((s) => s.statements);
  const pendentes = todas.filter((a) => !sustentada(a, validSegmentIds));

  function alterar(path: string, mudanca: Partial<NoteStatement> | null) {
    setSujo(true);
    setErro(null);
    setSecoes((atual) =>
      atual
        .map((s) => ({
          ...s,
          statements:
            mudanca === null
              ? s.statements.filter((a) => a.path !== path)
              : s.statements.map((a) => (a.path === path ? { ...a, ...mudanca } : a)),
        }))
        // Seção que ficou sem afirmação sai da nota. Um título sozinho sugere
        // que algo foi registrado ali quando nada foi.
        .filter((s) => s.statements.length > 0),
    );
  }

  async function enviar(approve: boolean) {
    setSalvando(true);
    setErro(null);
    const res = await fetch(`/api/sessions/${sessionId}/note/review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sections: secoes, approve }),
    });
    setSalvando(false);

    if (!res.ok) {
      const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
      setErro(corpo?.error ?? "não foi possível salvar");
      return;
    }
    setSujo(false);
    onSaved();
  }

  return (
    <section
      aria-labelledby="titulo-nota"
      className="vidro flex flex-col gap-5 rounded-[26px] px-4 pt-6 pb-5 sm:px-6"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <h2 id="titulo-nota" className="titulo-secao">
          Nota clínica
        </h2>
        {aprovada ? (
          <span className="ficha ficha-ok">
            <IconeCheck tamanho={14} traco={2.4} />
            Aprovada em {new Date(note.approvedAt ?? "").toLocaleString("pt-BR")}
          </span>
        ) : (
          <span className="ficha ficha-aviso">
            <span aria-hidden="true" className="ficha__ponto" />
            Rascunho
          </span>
        )}
        <span className="legenda ml-auto">
          {note.model ?? "modelo desconhecido"} · {note.promptVersion ?? "?"}
        </span>
      </div>

      {/*
       * O aviso do nível gratuito.
       *
       * Fica na tela, não só no log, porque quem opera o sistema não é
       * necessariamente quem o configurou. Um profissional testando não tem
       * como saber que o texto da consulta foi para um fornecedor que treina
       * com ele — e é justamente ele quem responde pelo dado do paciente.
       */}
      {note.content.dataPolicy === "training" && (
        <p className="alerta alerta-aviso text-[13px]">
          <strong className="font-semibold">
            Gerada com modelo de nível gratuito.
          </strong>{" "}
          O fornecedor pode registrar e treinar com a transcrição enviada. Use apenas
          com áudio de teste, nunca com consulta de paciente real.
        </p>
      )}

      {!aprovada && pendentes.length > 0 && (
        <p role="alert" className="alerta alerta-aviso flex items-start gap-2.5">
          <IconeAlerta tamanho={18} className="mt-0.5 shrink-0" />
          <span>
            <strong className="font-semibold">
              {pendentes.length} {pendentes.length === 1 ? "frase" : "frases"} sem
              âncora no áudio.
            </strong>{" "}
            Corrija, remova, ou assuma cada uma. Assumir registra que a informação é
            sua, não da transcrição.
          </span>
        </p>
      )}

      {secoes.length === 0 && (
        <p className="px-1 text-[15px] text-grafite">
          {sujo
            ? "Todas as afirmações foram removidas."
            : "O modelo não encontrou nada que sustentasse uma nota nesta consulta."}
        </p>
      )}

      {secoes.map((secao) => (
        <div key={secao.key} className="flex flex-col gap-1">
          <h3 className="px-3 pb-1 text-[13px] font-semibold text-grafite">
            {sectionTitle(secao.key)}
          </h3>
          <ul className="flex flex-col gap-1">
            {secao.statements.map((af) => {
              const ok = sustentada(af, validSegmentIds);
              const invalidas = af.sources.filter((s) => !validSegmentIds.has(s));
              const ativa =
                af.sources.length > 0 && af.sources.every((s) => activeSources.has(s));
              const tempo = invalidas.length === 0 ? tempoDe(af.sources) : null;

              if (editando === af.path) {
                return (
                  <li key={af.path} className="space-y-2 px-1 py-1">
                    <textarea
                      value={rascunho}
                      onChange={(e) => setRascunho(e.target.value)}
                      rows={3}
                      autoFocus
                      className="campo"
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          alterar(af.path, {
                            text: rascunho,
                            editedAt: new Date().toISOString(),
                          });
                          setEditando(null);
                        }}
                        className="botao-principal botao-pequeno"
                      >
                        Salvar frase
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditando(null)}
                        className="botao-texto"
                      >
                        cancelar
                      </button>
                    </div>
                  </li>
                );
              }

              return (
                <li key={af.path}>
                  <div
                    className={`rounded-2xl border px-3 py-2.5 transition-colors ${
                      !ok
                        ? "border-aviso-ponto/35 bg-[#fff6e3]"
                        : ativa
                          ? "vidro-polido border-white/95"
                          : "border-transparent hover:bg-white/60"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onCite(af.sources)}
                      disabled={af.sources.length === 0}
                      className={`w-full text-left text-[15.5px] leading-relaxed ${
                        !ok ? "text-[#5c3e00]" : "text-tinta"
                      } ${af.sources.length === 0 ? "cursor-default" : "cursor-pointer"}`}
                    >
                      {af.text}
                    </button>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px]">
                      {af.sources.length === 0 ? (
                        <span className="ficha ficha-aviso min-h-6 px-2.5 text-[12px]">
                          <IconeAlerta tamanho={13} traco={2} />
                          sem fonte no áudio
                        </span>
                      ) : invalidas.length > 0 ? (
                        <span className="ficha ficha-erro min-h-6 px-2.5 text-[12px]">
                          <IconeAlerta tamanho={13} traco={2} />
                          cita trecho que não existe
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onCite(af.sources)}
                          className="inline-flex min-h-6 items-center gap-1.5 rounded-full bg-viva/15 px-2.5 font-semibold text-viva-texto tabular-nums hover:bg-viva/25"
                        >
                          <IconeTocar tamanho={11} />
                          {tempo ?? "ouvir"}
                          {af.sources.length > 1 && (
                            <span className="font-medium">
                              · {af.sources.length} trechos
                            </span>
                          )}
                        </button>
                      )}

                      {af.confirmedAt !== undefined && (
                        <span className="ficha ficha-ok min-h-6 px-2.5 text-[12px]">
                          <IconeCheck tamanho={13} traco={2.4} />
                          assumida por você
                        </span>
                      )}
                      {af.editedAt !== undefined && (
                        <span className="text-nevoa">editada</span>
                      )}

                      {!aprovada && (
                        <span className="ml-auto flex gap-4">
                          <button
                            type="button"
                            onClick={() => {
                              setEditando(af.path);
                              setRascunho(af.text);
                            }}
                            className="botao-texto text-[12.5px]"
                          >
                            editar
                          </button>
                          {!ok && (
                            <button
                              type="button"
                              onClick={() =>
                                alterar(af.path, {
                                  confirmedAt: new Date().toISOString(),
                                })
                              }
                              className="botao-texto text-[12.5px]"
                            >
                              assumir
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => alterar(af.path, null)}
                            className="botao-texto perigo text-[12.5px]"
                          >
                            remover
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {erro !== null && (
        <p role="alert" className="alerta alerta-erro">
          {erro}
        </p>
      )}

      {!aprovada && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-1 pt-5">
          <button
            type="button"
            onClick={() => void enviar(true)}
            disabled={salvando || pendentes.length > 0}
            className="botao-principal"
          >
            {salvando ? "Salvando…" : "Aprovar nota"}
            <span className="botao-icone">
              <IconeCheck tamanho={19} traco={2} />
            </span>
          </button>

          {sujo && (
            <button
              type="button"
              onClick={() => void enviar(false)}
              disabled={salvando}
              className="botao-vidro"
            >
              Salvar sem aprovar
            </button>
          )}

          {/*
           * O que a aprovação significa, dito antes do clique.
           *
           * A §10 da documentação e as regras de prontuário do CFM colocam a
           * responsabilidade no profissional, não no software. Um botão
           * "Aprovar" sem essa frase deixaria a pessoa descobrir isso depois —
           * que é tarde, porque a assinatura já aconteceu.
           */}
          <span className="legenda basis-full">
            {pendentes.length > 0
              ? `Resolva ${pendentes.length} ${pendentes.length === 1 ? "pendência" : "pendências"} para aprovar.`
              : "Aprovar transforma o rascunho em registro clínico sob sua responsabilidade."}
          </span>
        </div>
      )}
    </section>
  );
}
