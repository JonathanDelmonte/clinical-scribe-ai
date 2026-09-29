"use client";

import { useEffect, useRef, useState } from "react";

/**
 * O vídeo atrás da tela de entrada.
 *
 * Sem `autoPlay` no HTML, de propósito: quem pediu ao sistema menos movimento
 * não pode receber um vídeo rodando antes de o React ter a chance de pará-lo.
 * O play acontece aqui, depois de conferir a preferência — e também é pulado
 * com economia de dados ligada, porque um fundo decorativo não vale o pacote
 * de dados de ninguém.
 *
 * Mudo, em loop e `playsInline`: é o que os navegadores de celular exigem
 * para tocar sozinho. Se o arquivo não carregar, o vídeo some e fica a luz da
 * atmosfera por trás — a tela continua inteira.
 */
export function VideoDeFundo({ src, capa }: { src: string; capa?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (video === null) return;

    const menosMovimento = window.matchMedia("(prefers-reduced-motion: reduce)");
    const economia =
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
        ?.saveData === true;

    const aplicar = () => {
      if (menosMovimento.matches || economia) {
        video.pause();
      } else {
        void video.play().catch(() => {
          // Autoplay recusado pelo navegador: fica a capa, ou a atmosfera.
        });
      }
    };

    aplicar();
    menosMovimento.addEventListener("change", aplicar);
    return () => menosMovimento.removeEventListener("change", aplicar);
  }, []);

  if (falhou) return null;

  return (
    <video
      ref={ref}
      src={src}
      {...(capa === undefined ? {} : { poster: capa })}
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
      onError={() => setFalhou(true)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}
