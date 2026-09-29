"use client";

import { IconeCheck } from "./Icones";
import { Orbe } from "./Orbe";

export interface ProgressData {
  percent: number | null;
  phase: string | null;
  etaSeconds: number | null;
  preview: string | null;
  status: string;
}

/**
 * As fases, na ordem em que acontecem.
 *
 * Mostrar a lista inteira — e não só a fase atual — responde de graça a
 * pergunta "falta muito?". Ver que a separação de vozes ainda vem depois é
 * informação que uma barra sozinha não dá.
 */
const FASES = [
  { chave: "preparando", rotulo: "Preparando o áudio" },
  { chave: "transcrevendo", rotulo: "Transcrevendo a conversa" },
  { chave: "separando", rotulo: "Separando as vozes" },
  { chave: "montando", rotulo: "Montando a transcrição" },
] as const;

function indiceDaFase(phase: string | null, status: string): number {
  if (status === "uploaded") return 0;
  const p = (phase ?? "").toLowerCase();
  if (p.includes("prepar")) return 0;
  if (p.includes("transcrev")) return 1;
  if (p.includes("separ") || p.includes("vozes")) return 2;
  if (p.includes("mont")) return 3;
  return 1;
}

function formatarEspera(segundos: number): string {
  if (segundos < 60) return `${Math.max(1, Math.round(segundos))} s`;
  const min = Math.floor(segundos / 60);
  const s = Math.round(segundos % 60);
  return s === 0 ? `${min} min` : `${min} min ${s} s`;
}

export function SessionProgress({ data }: { data: ProgressData }) {
  const fase = indiceDaFase(data.phase, data.status);

  // Na fila, antes de o motor começar, não há percentual nenhum. Mostrar 0%
  // com a barra parada parece travado; a barra indeterminada é honesta.
  const indeterminado = data.percent === null || data.status === "uploaded";
  const pct = Math.min(100, Math.max(0, data.percent ?? 0));

  return (
    <section
      aria-label="Processando a consulta"
      className="vidro flex flex-col gap-6 rounded-[26px] px-5 py-6 sm:flex-row sm:items-center sm:gap-8 sm:px-8"
    >
      {/*
       * O orbe pensando: a Viva está trabalhando nesta consulta. É o mesmo
       * corpo que ouviu a gravação, agora escrevendo.
       */}
      <div className="flex justify-center sm:block">
        <Orbe tamanho={112} modo="pensando" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-[15.5px] font-semibold">
              {data.phase ?? "Aguardando na fila"}
            </span>
            {!indeterminado && (
              <span className="text-[28px] leading-none font-light tabular-nums">
                {pct}%
              </span>
            )}
          </div>

          <div
            className="h-2 w-full overflow-hidden rounded-full bg-tinta/[0.07]"
            role="progressbar"
            aria-valuenow={indeterminado ? undefined : pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progresso do processamento"
          >
            {indeterminado ? (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-viva/60" />
            ) : (
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#8fe3d8] to-viva transition-[width] duration-700 ease-out"
                style={{ width: `${pct}%` }}
              />
            )}
          </div>

          {data.etaSeconds !== null && data.etaSeconds > 0 && (
            <p className="legenda mt-2">
              cerca de {formatarEspera(data.etaSeconds)} restantes
            </p>
          )}
        </div>

        <ol className="grid gap-2 sm:grid-cols-2">
          {FASES.map((f, i) => {
            const concluida = i < fase;
            const atual = i === fase;
            return (
              <li
                key={f.chave}
                className={`flex items-center gap-2.5 text-[14px] ${
                  concluida ? "text-grafite" : atual ? "text-tinta" : "text-nevoa/70"
                }`}
              >
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full ${
                    concluida
                      ? "bg-viva/20 text-viva-texto"
                      : atual
                        ? "bg-tinta text-perola"
                        : "border border-tinta/15"
                  }`}
                >
                  {concluida && <IconeCheck tamanho={12} traco={2.6} />}
                </span>
                <span className={atual ? "font-semibold" : ""}>{f.rotulo}</span>
                {atual && (
                  <span
                    aria-hidden="true"
                    className="size-1.5 animate-pulse rounded-full bg-viva"
                  />
                )}
              </li>
            );
          })}
        </ol>

        {/*
         * O trecho mais recente reconhecido.
         *
         * É a parte visual que prova que algo está acontecendo agora — barra e
         * porcentagem podem parecer decorativas, texto que muda não parece.
         * Também dá ao profissional uma primeira leitura da qualidade antes do
         * resultado final.
         */}
        {data.preview !== null && data.preview !== "" && (
          <div className="rounded-2xl border border-white/85 bg-white/55 px-4 py-3">
            <p className="legenda mb-1">Reconhecendo agora</p>
            <p className="text-[14.5px] italic">“{data.preview}”</p>
          </div>
        )}
      </div>
    </section>
  );
}
