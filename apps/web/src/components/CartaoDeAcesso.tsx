import Link from "next/link";

import { IconeEscudo } from "./Icones";

/**
 * O cartão de vidro de entrar e de criar conta, com as duas abas no topo.
 *
 * As abas são links entre `/entrar` e `/cadastrar`, e não um alternador na
 * mesma página: cada tela continua com o próprio endereço — o link "criar
 * conta" que alguém manda por mensagem abre direto no lugar certo, e o
 * `?de=` do login continua funcionando.
 */
export function CartaoDeAcesso({
  aba,
  titulo,
  subtitulo,
  children,
}: {
  aba: "entrar" | "cadastrar";
  titulo: string;
  subtitulo: string;
  children: React.ReactNode;
}) {
  const estilo = (ativa: boolean) =>
    `flex h-11 items-center justify-center rounded-full text-[15px] no-underline transition-colors ${
      ativa
        ? "vidro-polido font-semibold text-tinta"
        : "font-medium text-grafite hover:text-tinta"
    }`;

  return (
    <div className="vidro surgir surgir-2 w-full max-w-[440px] rounded-[32px] px-6 pt-6 pb-7 shadow-[inset_0_1px_0_rgb(255_255_255/0.95),0_40px_80px_-40px_rgb(22_52_70/0.4)] sm:px-9 sm:pt-8">
      <nav
        aria-label="Acesso"
        className="grid grid-cols-2 gap-1 rounded-full bg-tinta/5 p-1"
      >
        <Link
          href="/entrar"
          aria-current={aba === "entrar" ? "page" : undefined}
          className={estilo(aba === "entrar")}
        >
          Entrar
        </Link>
        <Link
          href="/cadastrar"
          aria-current={aba === "cadastrar" ? "page" : undefined}
          className={estilo(aba === "cadastrar")}
        >
          Criar conta
        </Link>
      </nav>

      <div className="mt-7 flex flex-col gap-2">
        <h1 className="text-[34px] leading-[1.05] font-normal tracking-[-0.03em]">
          {titulo}
        </h1>
        <p className="text-[15.5px] leading-normal text-grafite">{subtitulo}</p>
      </div>

      <div className="mt-7">{children}</div>

      {/*
       * A promessa de dados fica no cartão, e não escondida nos termos. É o
       * momento em que a pessoa decide confiar, e é o argumento que a §10 da
       * documentação transforma em recurso de produto.
       */}
      <div className="alerta alerta-info mt-6 flex items-start gap-3">
        <IconeEscudo tamanho={20} className="mt-px shrink-0 text-viva-texto" />
        <span className="flex flex-col gap-0.5 text-[13.5px]">
          <strong className="font-semibold text-tinta">
            Seus dados não treinam nenhuma IA.
          </strong>
          As gravações ficam guardadas no Brasil.
        </span>
      </div>
    </div>
  );
}
