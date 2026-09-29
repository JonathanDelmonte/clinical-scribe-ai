"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { IconeAjustes, IconeInicio, IconeMicrofone, IconePacientes } from "./Icones";
import { PontoViva } from "./Orbe";

/**
 * A navegação do celular: embaixo, ao alcance do polegar.
 *
 * O botão de gravar fica no centro e maior que os outros porque é para isso
 * que o celular existe neste produto — a consulta é gravada com o aparelho na
 * mesa, e começar precisa ser o toque mais fácil da tela.
 */
export function BarraInferior() {
  const caminho = usePathname();

  const aceso = {
    inicio: caminho === "/",
    pacientes:
      caminho.startsWith("/pacientes") ||
      caminho.startsWith("/sessoes") ||
      caminho.startsWith("/exportar"),
    viva: caminho.startsWith("/viva"),
    ajustes:
      caminho.startsWith("/configuracoes") ||
      caminho.startsWith("/uso") ||
      caminho.startsWith("/auditoria") ||
      caminho.startsWith("/bem-vindo"),
  };

  const item = (ligado: boolean) =>
    `flex h-14 flex-col items-center justify-center gap-0.5 text-[11.5px] ${
      ligado ? "font-semibold text-tinta" : "font-medium text-grafite"
    }`;

  return (
    <nav
      aria-label="Principal"
      className="vidro-polido fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 grid h-[70px] grid-cols-5 items-center rounded-[30px] px-1.5 lg:hidden"
    >
      <Link
        href="/"
        aria-current={aceso.inicio ? "page" : undefined}
        className={item(aceso.inicio)}
      >
        <IconeInicio
          tamanho={22}
          className={aceso.inicio ? "text-viva-texto" : undefined}
        />
        Início
      </Link>
      <Link
        href="/pacientes"
        aria-current={aceso.pacientes ? "page" : undefined}
        className={item(aceso.pacientes)}
      >
        <IconePacientes
          tamanho={22}
          className={aceso.pacientes ? "text-viva-texto" : undefined}
        />
        Pacientes
      </Link>
      <Link
        href="/#nova-consulta"
        aria-label="Nova consulta"
        className="-mt-7 grid size-[62px] place-items-center justify-self-center rounded-full bg-gradient-to-b from-[#1d2c37] to-tinta text-perola shadow-[0_0_0_5px_rgb(255_255_255/0.9),0_16px_30px_-12px_rgb(15_27_36/0.6)]"
      >
        <IconeMicrofone tamanho={24} />
      </Link>
      <Link
        href="/viva"
        aria-current={aceso.viva ? "page" : undefined}
        className={item(aceso.viva)}
      >
        <PontoViva tamanho={22} />
        Viva
      </Link>
      <Link
        href="/configuracoes"
        aria-current={aceso.ajustes ? "page" : undefined}
        className={item(aceso.ajustes)}
      >
        <IconeAjustes
          tamanho={22}
          className={aceso.ajustes ? "text-viva-texto" : undefined}
        />
        Ajustes
      </Link>
    </nav>
  );
}
