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
    <section
      aria-label="Rascunho ao vivo"
      className="vidro flex flex-col gap-3 rounded-[26px] px-5 py-5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-[14px] font-semibold">Rascunho ao vivo</h3>

        {estado.fase === "carregando" && (
          <span className="legenda">
            preparando o reconhecimento no seu dispositivo
            {estado.progresso > 0 ? ` · ${Math.round(estado.progresso)}%` : "…"}
          </span>
        )}

        {estado.fase === "ouvindo" && (
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-viva-texto">
            <span
              aria-hidden="true"
              className="size-1.5 animate-pulse rounded-full bg-current"
            />
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
      <p className="alerta alerta-aviso px-3.5 py-2.5 text-[12.5px]">
        <strong className="font-semibold">Isto não é a transcrição final.</strong> É um
        modelo pequeno rodando no seu aparelho, sem separar as vozes e com bem mais
        erros. Serve para você confirmar que o áudio está sendo captado. A transcrição
        de verdade vem depois da consulta.
      </p>

      {estado.fase === "indisponivel" ? (
        <p className="legenda">
          Rascunho ao vivo indisponível neste navegador ({estado.motivo}).{" "}
          <strong className="text-tinta">A gravação continua normalmente</strong> — ela
          não depende deste recurso.
        </p>
      ) : trechos.length === 0 ? (
        <p className="text-[14.5px] text-nevoa italic">
          {estado.fase === "carregando"
            ? "o modelo é baixado uma vez e fica guardado para as próximas consultas"
            : "aguardando alguém falar…"}
        </p>
      ) : (
        <div className="max-h-56 space-y-2 overflow-y-auto text-[15.5px] leading-relaxed">
          {trechos.map((t, i) => (
            <p
              key={i}
              className={i === trechos.length - 1 ? "text-tinta" : "text-tinta/45"}
            >
              {t}
            </p>
          ))}
          <div ref={fimRef} />
        </div>
      )}
    </section>
  );
}
