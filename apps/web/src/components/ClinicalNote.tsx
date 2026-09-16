"use client";

import { sectionTitle, type SecaoChave } from "@scribe/core";
import { useState } from "react";

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
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xs font-medium tracking-widest text-muted uppercase">
          Nota clínica
        </h2>
        {aprovada ? (
          <span className="rounded bg-accent/15 px-2 py-0.5 text-xs text-accent">
            aprovada em {new Date(note.approvedAt ?? "").toLocaleString("pt-BR")}
          </span>
        ) : (
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
            rascunho
          </span>
        )}
        <span className="text-xs text-muted">
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
        <p className="rounded-lg bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
          <strong>Gerada com modelo de nível gratuito.</strong> O fornecedor pode
          registrar e treinar com a transcrição enviada. Use apenas com áudio de teste —
          nunca com consulta de paciente real.
        </p>
      )}

      {!aprovada && pendentes.length > 0 && (
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-500"
        >
          <strong>
            {pendentes.length} {pendentes.length === 1 ? "afirmação" : "afirmações"} sem
            âncora no áudio.
          </strong>{" "}
          Corrija, remova, ou assuma cada uma. Assumir registra que a informação é sua,
          não da transcrição.
        </p>
      )}

      {secoes.length === 0 && (
        <p className="text-sm text-muted">
          {sujo
            ? "Todas as afirmações foram removidas."
            : "O modelo não encontrou nada que sustentasse uma nota nesta consulta."}
        </p>
      )}

      {secoes.map((secao) => (
        <div key={secao.key} className="rounded-lg border border-line px-5 py-4">
          <h3 className="mb-2 text-sm font-medium">{sectionTitle(secao.key)}</h3>
          <ul className="space-y-2">
            {secao.statements.map((af) => {
              const ok = sustentada(af, validSegmentIds);
              const invalidas = af.sources.filter((s) => !validSegmentIds.has(s));
              const ativa =
                af.sources.length > 0 && af.sources.every((s) => activeSources.has(s));

              if (editando === af.path) {
                return (
                  <li key={af.path} className="space-y-2">
                    <textarea
                      value={rascunho}
                      onChange={(e) => setRascunho(e.target.value)}
                      rows={3}
                      autoFocus
                      className="w-full rounded-md border border-accent bg-transparent px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          alterar(af.path, {
                            text: rascunho,
                            editedAt: new Date().toISOString(),
                          });
                          setEditando(null);
                        }}
                        className="rounded bg-accent px-3 py-1 text-xs font-medium text-surface"
                      >
                        Salvar frase
                      </button>
                      <button
                        onClick={() => setEditando(null)}
                        className="text-xs text-muted hover:text-ink"
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
                    className={`rounded-md px-3 py-2 text-sm ${
                      !ok
                        ? "bg-red-500/10"
                        : ativa
                          ? "bg-accent/15"
                          : "hover:bg-accent/5"
                    }`}
                  >
                    <button
                      onClick={() => onCite(af.sources)}
                      disabled={af.sources.length === 0}
                      className={`w-full text-left ${!ok ? "text-red-600 dark:text-red-400" : ""} ${
                        af.sources.length === 0 ? "cursor-default" : "cursor-pointer"
                      }`}
                    >
                      {af.text}
                    </button>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {af.sources.length === 0 ? (
                        <span className="font-medium text-red-600 dark:text-red-400">
                          ⚠ sem fonte
                        </span>
                      ) : invalidas.length > 0 ? (
                        <span className="font-medium text-red-600 dark:text-red-400">
                          ⚠ cita trecho que não existe
                        </span>
                      ) : (
                        <button
                          onClick={() => onCite(af.sources)}
                          className="text-muted hover:text-accent"
                        >
                          ▸ ouvir {af.sources.length}{" "}
                          {af.sources.length === 1 ? "trecho" : "trechos"}
                        </button>
                      )}

                      {af.confirmedAt !== undefined && (
                        <span className="text-accent">✓ assumida por você</span>
                      )}
                      {af.editedAt !== undefined && (
                        <span className="text-muted">editada</span>
                      )}

                      {!aprovada && (
                        <span className="ml-auto flex gap-3">
                          <button
                            onClick={() => {
                              setEditando(af.path);
                              setRascunho(af.text);
                            }}
                            className="text-muted underline underline-offset-2 hover:text-ink"
                          >
                            editar
                          </button>
                          {!ok && (
                            <button
                              onClick={() =>
                                alterar(af.path, {
                                  confirmedAt: new Date().toISOString(),
                                })
                              }
                              className="text-muted underline underline-offset-2 hover:text-ink"
                            >
                              assumir
                            </button>
                          )}
                          <button
                            onClick={() => alterar(af.path, null)}
                            className="text-muted underline underline-offset-2 hover:text-red-500"
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
        <p role="alert" className="text-sm text-red-500">
          {erro}
        </p>
      )}

      {!aprovada && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button
            onClick={() => void enviar(true)}
            disabled={salvando || pendentes.length > 0}
            className="rounded-lg bg-accent px-5 py-2.5 font-medium text-surface disabled:opacity-40"
          >
            {salvando ? "salvando…" : "Aprovar nota"}
          </button>

          {sujo && (
            <button
              onClick={() => void enviar(false)}
              disabled={salvando}
              className="rounded-lg border border-line px-4 py-2.5 text-sm disabled:opacity-40"
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
          <span className="text-xs text-muted">
            {pendentes.length > 0
              ? `resolva ${pendentes.length} ${pendentes.length === 1 ? "pendência" : "pendências"} para aprovar`
              : "aprovar transforma o rascunho em registro clínico sob sua responsabilidade"}
          </span>
        </div>
      )}
    </section>
  );
}
