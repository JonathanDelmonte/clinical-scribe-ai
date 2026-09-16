"use client";

import { useEffect, useRef } from "react";

import type { EstadoRascunho } from "@/lib/useLiveDraft";

interface Props {
  estado: EstadoRascunho;
  trechos: readonly string[];
}

/**
 * O rascunho ao vivo na tela.
 *
 * Existe por um motivo que não é o óbvio. O valor não é ler o texto — é ver
 * que ELE APARECE: se o microfone estiver mudo, se o celular tiver capturado a
 * rua em vez da sala, ou se o navegador tiver silenciado a captura, dá para
 * perceber no primeiro minuto em vez de descobrir depois que o paciente foi
 * embora.
 *
 * Por isso o aviso não é rodapé nem asterisco. Um texto na tela durante a
 * consulta será lido como "a transcrição"; dizer o contrário só funciona se
 * estiver junto do texto, o tempo todo.
 */
export function LiveDraft({ estado, trechos }: Props) {
  const fimRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [trechos.length]);

  if (estado.fase === "parado") return null;

  return (
    <section className="space-y-2 rounded-lg border border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-xs font-medium tracking-widest text-muted uppercase">
          Rascunho ao vivo
        </h3>

        {estado.fase === "carregando" && (
          <span className="text-xs text-muted">
            preparando o reconhecimento no seu dispositivo
            {estado.progresso > 0 ? ` · ${Math.round(estado.progresso)}%` : "…"}
          </span>
        )}

        {estado.fase === "ouvindo" && (
          <span className="flex items-center gap-1.5 text-xs text-accent">
            <span className="size-1.5 animate-pulse rounded-full bg-current" />
            ouvindo{estado.acelerado ? " · acelerado por GPU" : ""}
          </span>
        )}
      </div>

      {/*
       * O aviso, acima do texto e não abaixo.
       *
       * Embaixo, ele é lido depois — ou não é lido. Acima, ele emoldura o que
       * vem a seguir, que é o único lugar em que um aviso sobre confiabilidade
       * funciona.
       */}
      <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
        <strong>Isto não é a transcrição final.</strong> É um modelo pequeno rodando no
        seu aparelho, sem separar as vozes e com bem mais erros. Serve para você
        confirmar que o áudio está sendo captado. A transcrição de verdade vem depois da
        consulta.
      </p>

      {estado.fase === "indisponivel" ? (
        <p className="text-xs text-muted">
          Rascunho ao vivo indisponível neste navegador ({estado.motivo}).{" "}
          <strong className="text-ink">A gravação continua normalmente</strong> — ela
          não depende deste recurso.
        </p>
      ) : trechos.length === 0 ? (
        <p className="text-sm text-muted italic">
          {estado.fase === "carregando"
            ? "o modelo é baixado uma vez e fica guardado para as próximas consultas"
            : "aguardando alguém falar…"}
        </p>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto text-sm">
          {trechos.map((t, i) => (
            <p key={i} className={i === trechos.length - 1 ? "" : "text-muted"}>
              {t}
            </p>
          ))}
          <div ref={fimRef} />
        </div>
      )}
    </section>
  );
}
