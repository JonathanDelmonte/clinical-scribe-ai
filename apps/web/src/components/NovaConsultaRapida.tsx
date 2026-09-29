"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { IconeEnviarArquivo, IconeMicrofone } from "./Icones";

/**
 * "Para quem é a consulta?" e o botão de começar, no Início.
 *
 * Os dois caminhos levam à pasta do paciente, onde mora o gravador: é lá que
 * ficam a ciência da gravação, o objetivo da sessão e o envio de arquivo, e um
 * segundo gravador aqui seria um segundo lugar para esse cuidado divergir. O
 * Início só encurta o caminho — escolher a pessoa e chegar pronto para gravar.
 */
export function NovaConsultaRapida({
  pacientes,
}: {
  pacientes: readonly { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [escolhido, setEscolhido] = useState(pacientes[0]?.id ?? "");

  if (pacientes.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-[15px] text-grafite">
          Primeiro, cadastre a pessoa que você vai atender.
        </p>
        <Link href="/pacientes?novo=1" className="botao-principal">
          Cadastrar paciente
        </Link>
      </div>
    );
  }

  function irPara() {
    if (escolhido !== "") router.push(`/pacientes/${escolhido}#consulta`);
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        irPara();
      }}
    >
      <label className="block max-w-xs">
        <span className="rotulo">Para quem é a consulta?</span>
        <select
          className="campo vidro-polido rounded-full"
          value={escolhido}
          onChange={(e) => setEscolhido(e.target.value)}
        >
          {pacientes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="botao-principal">
          Começar consulta
          <span className="botao-icone">
            <IconeMicrofone tamanho={19} />
          </span>
        </button>
        <button type="button" onClick={irPara} className="botao-fantasma">
          <IconeEnviarArquivo tamanho={19} />
          Enviar um áudio
        </button>
      </div>
    </form>
  );
}
