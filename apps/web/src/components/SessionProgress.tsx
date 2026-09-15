"use client";

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
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium">
            {data.phase ?? "aguardando na fila"}
          </span>
          {!indeterminado && (
            <span className="font-mono text-2xl tabular-nums">{pct}%</span>
          )}
        </div>

        <div
          className="h-2 w-full overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuenow={indeterminado ? undefined : pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progresso do processamento"
        >
          {indeterminado ? (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/60" />
          ) : (
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          )}
        </div>

        {data.etaSeconds !== null && data.etaSeconds > 0 && (
          <p className="mt-2 text-sm text-muted">
            cerca de {formatarEspera(data.etaSeconds)} restantes
          </p>
        )}
      </div>

      <ol className="space-y-1.5">
        {FASES.map((f, i) => {
          const concluida = i < fase;
          const atual = i === fase;
          return (
            <li
              key={f.chave}
              className={`flex items-center gap-2.5 text-sm ${
                concluida ? "text-muted" : atual ? "text-ink" : "text-muted/50"
              }`}
            >
              <span
                className={`flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                  concluida
                    ? "bg-accent/20 text-accent"
                    : atual
                      ? "bg-accent text-surface"
                      : "border border-line"
                }`}
              >
                {concluida ? "✓" : atual ? "" : ""}
              </span>
              <span className={atual ? "font-medium" : ""}>{f.rotulo}</span>
              {atual && (
                <span className="size-1.5 animate-pulse rounded-full bg-accent" />
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
        <div className="rounded-lg border border-line bg-accent/5 px-4 py-3">
          <p className="mb-1 text-xs tracking-widest text-muted uppercase">
            reconhecendo agora
          </p>
          <p className="text-sm italic">“{data.preview}”</p>
        </div>
      )}
    </div>
  );
}
