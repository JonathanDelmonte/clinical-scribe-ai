"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NOME_DO_PLANO } from "@/lib/plano";

import { Avatar } from "./Avatar";
import {
  IconeAjustes,
  IconeEscudo,
  IconeInicio,
  IconeMicrofone,
  IconePacientes,
  IconeUso,
} from "./Icones";
import { PontoViva } from "./Orbe";
import { SairButton } from "./SairButton";

/**
 * Onde cada item do menu acende.
 *
 * Uma consulta mora dentro da pasta de um paciente, então abrir uma consulta
 * mantém "Pacientes" aceso; perfil, auditoria e dados moram dentro de
 * "Ajustes". Um menu que apaga tudo quando a pessoa desce um nível faz ela
 * perder o lugar em que está.
 */
function ativo(
  caminho: string,
  item: "inicio" | "pacientes" | "viva" | "uso" | "ajustes",
) {
  switch (item) {
    case "inicio":
      return caminho === "/";
    case "pacientes":
      return (
        caminho.startsWith("/pacientes") ||
        caminho.startsWith("/sessoes") ||
        caminho.startsWith("/exportar")
      );
    case "viva":
      return caminho.startsWith("/viva");
    case "uso":
      return caminho.startsWith("/uso");
    case "ajustes":
      return (
        caminho.startsWith("/configuracoes") ||
        caminho.startsWith("/auditoria") ||
        caminho.startsWith("/bem-vindo")
      );
  }
}

export function BarraLateral({
  profissional,
  minutosUsados,
  tetoMinutos,
  className,
}: {
  profissional: { id: string; nome: string; detalhe: string; plano: string };
  minutosUsados: number;
  /** `null` = sem teto: plano pago ou cargo de desenvolvedor. */
  tetoMinutos: number | null;
  className?: string | undefined;
}) {
  const caminho = usePathname();

  const item = (aceso: boolean) =>
    `flex h-[46px] items-center gap-3 rounded-2xl border px-3.5 text-[15px] transition-colors ${
      aceso
        ? "vidro-polido border-white/95 font-semibold text-tinta"
        : "border-transparent font-medium text-grafite hover:bg-white/60 hover:text-tinta"
    }`;

  const usadoPorCento =
    tetoMinutos === null ? 0 : Math.min(100, (minutosUsados / tetoMinutos) * 100);

  return (
    <aside
      className={`vidro flex w-64 shrink-0 flex-col gap-6 px-3.5 pt-5 pb-4 ${className ?? ""}`}
      aria-label="Navegação"
    >
      <Link href="/" className="flex items-center gap-2.5 px-2.5 text-tinta">
        <PontoViva tamanho={28} />
        <span className="text-[17px] font-semibold tracking-tight">Consulta Viva</span>
      </Link>

      {/*
       * A ação principal mora no topo do menu, antes da navegação: é o que o
       * profissional faz mais vezes por dia, e fica no mesmo lugar em
       * qualquer tela.
       */}
      <Link href="/#nova-consulta" className="botao-principal w-full justify-between">
        Nova consulta
        <span className="botao-icone">
          <IconeMicrofone tamanho={19} />
        </span>
      </Link>

      <nav aria-label="Principal" className="flex flex-col gap-1">
        <Link
          href="/"
          aria-current={ativo(caminho, "inicio") ? "page" : undefined}
          className={item(ativo(caminho, "inicio"))}
        >
          <IconeInicio
            className={ativo(caminho, "inicio") ? "text-viva-texto" : "text-nevoa"}
          />
          Início
        </Link>
        <Link
          href="/pacientes"
          aria-current={ativo(caminho, "pacientes") ? "page" : undefined}
          className={item(ativo(caminho, "pacientes"))}
        >
          <IconePacientes
            className={ativo(caminho, "pacientes") ? "text-viva-texto" : "text-nevoa"}
          />
          Pacientes
        </Link>
        <Link
          href="/viva"
          aria-current={ativo(caminho, "viva") ? "page" : undefined}
          className={item(ativo(caminho, "viva"))}
        >
          <PontoViva tamanho={20} />
          Viva
          <span className="ml-auto rounded-full bg-processando-fundo px-2 py-0.5 text-[11.5px] font-semibold tracking-wide text-processando">
            IA
          </span>
        </Link>
      </nav>

      <div aria-hidden="true" className="mx-3 -my-2 h-px bg-line" />

      <nav aria-label="Conta" className="flex flex-col gap-1">
        <Link
          href="/uso"
          aria-current={ativo(caminho, "uso") ? "page" : undefined}
          className={item(ativo(caminho, "uso"))}
        >
          <IconeUso
            className={ativo(caminho, "uso") ? "text-viva-texto" : "text-nevoa"}
          />
          Uso e plano
        </Link>
        <Link
          href="/configuracoes"
          aria-current={ativo(caminho, "ajustes") ? "page" : undefined}
          className={item(ativo(caminho, "ajustes"))}
        >
          <IconeAjustes
            className={ativo(caminho, "ajustes") ? "text-viva-texto" : "text-nevoa"}
          />
          Ajustes
        </Link>
      </nav>

      <div className="flex-1" />

      <Link
        href="/uso"
        className="flex flex-col gap-2.5 rounded-2xl border border-white/90 bg-white/55 px-3.5 pt-3.5 pb-4 transition-colors hover:bg-white/75"
      >
        <span className="flex items-baseline justify-between text-[13px]">
          <span className="font-semibold text-tinta">
            {NOME_DO_PLANO[profissional.plano] ?? profissional.plano}
          </span>
          <span className="text-nevoa">este mês</span>
        </span>
        {tetoMinutos !== null && (
          <span
            aria-hidden="true"
            className="h-2 overflow-hidden rounded-full bg-tinta/[0.07]"
          >
            <span
              className={`block h-full rounded-full ${
                usadoPorCento >= 100
                  ? "bg-erro"
                  : "bg-gradient-to-r from-[#8fe3d8] to-viva"
              }`}
              style={{ width: `${usadoPorCento}%` }}
            />
          </span>
        )}
        <span className="text-[13px] text-grafite">
          {tetoMinutos === null
            ? `${Math.round(minutosUsados)} minutos usados, sem limite`
            : `${Math.round(minutosUsados)} de ${tetoMinutos} minutos usados`}
        </span>
      </Link>

      <div className="flex items-center gap-2.5 pl-1.5">
        <Avatar nome={profissional.nome} chave={profissional.id} tamanho={40} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-tinta">
            {profissional.nome}
          </span>
          {profissional.detalhe !== "" && (
            <span className="truncate text-[12.5px] text-nevoa">
              {profissional.detalhe}
            </span>
          )}
        </span>
        <SairButton />
      </div>

      <Link
        href="/privacidade"
        className="flex items-center gap-2 px-2.5 text-[12.5px] text-grafite hover:text-tinta"
      >
        <IconeEscudo tamanho={16} className="text-viva-texto" />
        Seus dados não treinam nenhuma IA
      </Link>
    </aside>
  );
}
