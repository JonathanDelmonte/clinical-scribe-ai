import Link from "next/link";

import { Atmosfera } from "./Atmosfera";
import { PontoViva } from "./Orbe";

/**
 * A moldura das páginas de privacidade e termos.
 *
 * Existe para que as duas fiquem iguais sem copiar layout, e para carregar num
 * lugar só a data de vigência — que é a informação que um documento desses
 * precisa ter e que é a mais fácil de esquecer de atualizar em dois arquivos.
 */

/**
 * Vigência dos documentos legais.
 *
 * ⚠️ Mudou o texto de privacidade ou dos termos? **Mude esta data.** Um
 * documento legal sem data de vigência não diz o que valia quando a pessoa
 * aceitou — e é exatamente isso que ele precisa dizer.
 */
export const VIGENCIA = "22 de setembro de 2026";

export function PaginaLegal({
  titulo,
  resumo,
  children,
}: {
  titulo: string;
  resumo: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <Atmosfera />
      <main className="mx-auto max-w-[760px] px-4 py-6 sm:px-6 sm:py-10">
        <nav className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3 px-1 text-sm">
          <Link
            href="/"
            className="mr-auto inline-flex items-center gap-2.5 text-tinta no-underline"
          >
            <PontoViva tamanho={24} />
            <span className="text-[16px] font-semibold tracking-tight">
              Consulta Viva
            </span>
          </Link>
          <Link
            href="/privacidade"
            className="text-grafite no-underline hover:text-tinta"
          >
            Privacidade
          </Link>
          <Link href="/termos" className="text-grafite no-underline hover:text-tinta">
            Termos
          </Link>
        </nav>

        <article className="vidro rounded-[30px] px-6 py-8 sm:px-10 sm:py-11">
          <h1 className="titulo-pagina">{titulo}</h1>
          <p className="mt-4 text-[16.5px] leading-relaxed text-grafite">{resumo}</p>
          <p className="legenda mt-2">Em vigor desde {VIGENCIA}.</p>

          {/*
           * `prose` não existe neste projeto (não há plugin de tipografia), então
           * o espaçamento é dado aqui, uma vez, em vez de repetido em cada
           * parágrafo dos dois documentos.
           */}
          <div className="mt-10 flex flex-col gap-9 text-[15px] leading-relaxed [&_a]:font-medium [&_a]:text-viva-texto [&_a]:underline [&_a]:decoration-viva-texto/35 [&_a]:underline-offset-[3px]">
            {children}
          </div>
        </article>
      </main>
    </>
  );
}

export function Secao({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="titulo-secao text-[18px]">{titulo}</h2>
      {children}
    </section>
  );
}

export function Lista({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col gap-2.5">{children}</ul>;
}

export function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-2.5 size-1.5 shrink-0 rounded-full bg-viva"
      />
      <span>{children}</span>
    </li>
  );
}
