import Link from "next/link";

import { IconeMicrofone } from "./Icones";
import { Orbe } from "./Orbe";

/**
 * A porta para a Viva, no pé do Início.
 *
 * Parece um campo de texto, mas é um link — perguntar acontece na tela da
 * Viva, onde há espaço para a resposta. O exemplo entre aspas está ali para
 * ensinar o que dá para perguntar sem precisar de manual.
 */
export function BarraViva({ className }: { className?: string | undefined }) {
  return (
    <Link
      href="/viva"
      className={`vidro-polido group flex h-[72px] w-full max-w-[640px] items-center gap-3.5 rounded-full pr-2.5 pl-3 text-tinta no-underline shadow-[inset_0_1px_0_#fff,0_28px_60px_-26px_rgb(22_52_70/0.45)] ${className ?? ""}`}
    >
      <Orbe tamanho={46} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">Pergunte à Viva</span>
        <span className="truncate text-[14px] text-nevoa">
          “O que eu combinei com o João sobre o jantar?”
        </span>
      </span>
      <span className="hidden px-1.5 text-[12.5px] text-nevoa sm:inline">
        digite ou fale
      </span>
      <span
        aria-hidden="true"
        className="grid size-[52px] shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#1d2c37] to-tinta text-perola transition-transform group-hover:scale-105"
      >
        <IconeMicrofone />
      </span>
    </Link>
  );
}
