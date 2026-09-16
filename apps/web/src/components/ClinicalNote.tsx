"use client";

import { sectionTitle, type SecaoChave } from "@scribe/core";

export interface NoteStatement {
  path: string;
  text: string;
  sources: string[];
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
  /** IDs de trechos que existem de verdade — para marcar fonte fabricada. */
  validSegmentIds: Set<string>;
  activeSources: Set<string>;
  onCite: (sources: string[]) => void;
}

/**
 * A nota clínica, com cada afirmação ligada ao que foi dito.
 *
 * A conferência determinística já provou que toda fonte citada EXISTE. O que
 * ela não tem como provar é que a fonte SUSTENTA a afirmação — para isso
 * alguém precisa ouvir. É por isso que cada afirmação aqui é clicável: o
 * caminho entre ler "dor lombar há três dias" e ouvir o paciente dizer isso
 * precisa ser um toque, não uma busca no áudio.
 *
 * Quando revisar custa caro, ninguém revisa; e uma nota não revisada é
 * exatamente o cenário dos 62% de achados fabricados que passaram (§11).
 */
export function ClinicalNote({ note, validSegmentIds, activeSources, onCite }: Props) {
  const secoes = note.content.sections ?? [];
  const problemas = note.citationIssues ?? [];

  const semFonte = new Set(
    problemas.filter((p) => p.kind === "missing_sources").map((p) => p.path),
  );
  const fonteInventada = new Set(
    problemas.filter((p) => p.kind === "unknown_segment").map((p) => p.path),
  );
  const bloqueantes = semFonte.size + fonteInventada.size;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xs font-medium tracking-widest text-muted uppercase">
          Nota clínica
        </h2>
        {note.approvedAt === null ? (
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
            rascunho
          </span>
        ) : (
          <span className="rounded bg-accent/15 px-2 py-0.5 text-xs text-accent">
            aprovada
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

      {bloqueantes > 0 && (
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-500"
        >
          <strong>
            {bloqueantes} {bloqueantes === 1 ? "afirmação" : "afirmações"} sem âncora no
            áudio.
          </strong>{" "}
          Estão marcadas abaixo. Afirmação sem fonte não foi verificada contra o que foi
          dito — confira ou apague antes de aprovar.
        </p>
      )}

      {secoes.length === 0 && (
        <p className="text-sm text-muted">
          O modelo não encontrou nada que sustentasse uma nota nesta consulta.
        </p>
      )}

      {secoes.map((secao) => (
        <div key={secao.key} className="rounded-lg border border-line px-5 py-4">
          <h3 className="mb-2 text-sm font-medium">{sectionTitle(secao.key)}</h3>
          <ul className="space-y-2">
            {secao.statements.map((af) => {
              const invalidas = af.sources.filter((s) => !validSegmentIds.has(s));
              const ruim = semFonte.has(af.path) || fonteInventada.has(af.path);
              const ativa =
                af.sources.length > 0 && af.sources.every((s) => activeSources.has(s));

              return (
                <li key={af.path}>
                  <button
                    onClick={() => onCite(af.sources)}
                    disabled={af.sources.length === 0}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      ruim
                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                        : ativa
                          ? "bg-accent/15"
                          : "hover:bg-accent/5"
                    } ${af.sources.length === 0 ? "cursor-default" : "cursor-pointer"}`}
                  >
                    <span>{af.text}</span>

                    {af.sources.length === 0 ? (
                      <span className="mt-1 block text-xs font-medium">
                        ⚠ sem fonte — não verificável
                      </span>
                    ) : invalidas.length > 0 ? (
                      <span className="mt-1 block text-xs font-medium">
                        ⚠ cita trecho que não existe ({invalidas.join(", ")})
                      </span>
                    ) : (
                      <span className="mt-1 block text-xs text-muted">
                        ▸ ouvir {af.sources.length}{" "}
                        {af.sources.length === 1 ? "trecho" : "trechos"}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
