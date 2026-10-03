"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { IconeCheck, IconeExportar } from "./Icones";

export interface ComputadorConectado {
  readonly id: string;
  readonly nome: string;
  /** "Placa de vídeo" ou "Processador". */
  readonly motor: string;
  /** "Ligado agora", "Em pausa", "Visto ontem"… — calculado no servidor. */
  readonly situacao: string;
  readonly ligado: boolean;
}

/**
 * O ajudante: o programa que processa as consultas no computador da pessoa
 * (ADR-0005). Aqui ela baixa, vê quais computadores estão conectados à conta,
 * e desconecta o que não usa mais — o que perdeu, ou o que deu a alguém.
 */
export function AjudanteDoComputador({
  computadores,
  linkDeDownload,
}: {
  computadores: readonly ComputadorConectado[];
  linkDeDownload: string;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [desconectando, setDesconectando] = useState<string | null>(null);
  const algumLigado = computadores.some((c) => c.ligado);

  async function desconectar(id: string) {
    setErro(null);
    setDesconectando(id);
    const res = await fetch(`/api/configuracoes/ajudantes/${id}`, {
      method: "DELETE",
    }).catch(() => null);
    setDesconectando(null);
    if (res === null || (!res.ok && res.status !== 404)) {
      setErro("Não foi possível desconectar agora. Tente de novo.");
      return;
    }
    router.refresh();
  }

  return (
    <section
      id="ajudante"
      className="vidro flex flex-col items-start gap-5 rounded-[26px] px-6 py-6"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="titulo-secao">O ajudante</h2>
        {algumLigado ? (
          <span className="ficha ficha-ok">
            <IconeCheck tamanho={14} />
            Ligado
          </span>
        ) : (
          <span className="ficha">
            {computadores.length === 0 ? "Nenhum computador" : "Desligado"}
          </span>
        )}
      </div>

      <p className="text-[15.5px] leading-relaxed text-grafite">
        Com o ajudante ligado, as suas consultas são processadas no seu próprio
        computador, ao lado do relógio do Windows: fica mais rápido, e o cadastro da voz
        funciona a qualquer hora. Desligado, a estação da equipe processa, como sempre.
      </p>

      <a href={linkDeDownload} className="botao-vidro no-underline">
        <IconeExportar tamanho={18} />
        Baixar o ajudante para Windows
      </a>

      {computadores.length > 0 && (
        <ul className="flex w-full flex-col gap-2">
          {computadores.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl bg-tinta/[0.04] px-4 py-3"
            >
              <span className="flex flex-col">
                <span className="text-[15px] font-semibold text-tinta">{c.nome}</span>
                <span className="text-[13px] text-nevoa">
                  {c.situacao} · {c.motor}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void desconectar(c.id)}
                disabled={desconectando !== null}
                className="botao-texto"
              >
                {desconectando === c.id ? "Desconectando…" : "Desconectar"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[13.5px] leading-relaxed text-grafite">
        Para conectar um computador, instale o ajudante nele e escolha &quot;Conectar à
        sua conta&quot;. Nenhuma chave fica no programa: ele entra pela sua conta, aqui
        no site.
      </p>

      {erro !== null && (
        <p role="alert" className="alerta alerta-erro">
          {erro}
        </p>
      )}
    </section>
  );
}
