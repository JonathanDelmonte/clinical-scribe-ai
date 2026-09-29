"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { normalizarParaBusca } from "@/lib/patients";
import { haQuanto } from "@/lib/saudacao";

import { Avatar } from "./Avatar";
import { IconeBusca } from "./Icones";

export interface PacienteDaLista {
  id: string;
  nome: string;
  consultas: number;
  /** ISO da última consulta, ou `null` se nunca houve. */
  ultima: string | null;
  paraRevisar: number;
}

type Filtro = "todos" | "revisar" | "sem";

/**
 * A lista de pacientes, com busca e filtros.
 *
 * A busca acontece aqui no aparelho, e não no banco: a lista inteira já veio
 * para a tela, e filtrar em memória responde a cada letra sem ida ao servidor
 * nem respostas chegando fora de ordem. Sem acento e sem maiúscula — quem
 * digita "joao" procura o João.
 *
 * O termo vive também na URL (`?q=`), e não só no estado do componente. É o
 * que faz a busca sobreviver ao recarregar e continuar lá quando a pessoa
 * volta da ficha de um paciente com o botão de voltar — e é por onde chega o
 * termo digitado na busca do Início. `replaceState` e não `pushState`: cada
 * letra digitada viraria uma entrada no histórico, e sair da tela custaria um
 * toque em "voltar" por caractere.
 */
export function ListaDePacientes({
  pacientes,
  agora,
}: {
  pacientes: readonly PacienteDaLista[];
  /** O "agora" do servidor, para "hoje" e "ontem" não mudarem na hidratação. */
  agora: string;
}) {
  const caminho = usePathname();
  const parametros = useSearchParams();
  const [termo, setTermo] = useState(parametros.get("q") ?? "");
  const [filtro, setFiltro] = useState<Filtro>("todos");

  function buscar(novo: string) {
    setTermo(novo);
    const params = new URLSearchParams(window.location.search);
    if (novo.trim() === "") params.delete("q");
    else params.set("q", novo.trim());
    const consulta = params.toString();
    window.history.replaceState(
      null,
      "",
      consulta === "" ? caminho : `${caminho}?${consulta}`,
    );
  }

  const referencia = useMemo(() => new Date(agora), [agora]);
  const aberto = caminho.startsWith("/pacientes/") ? caminho.split("/")[2] : undefined;

  const contagem = {
    todos: pacientes.length,
    revisar: pacientes.filter((p) => p.paraRevisar > 0).length,
    sem: pacientes.filter((p) => p.consultas === 0).length,
  };

  const busca = normalizarParaBusca(termo);
  const visiveis = pacientes.filter(
    (p) =>
      (filtro === "revisar"
        ? p.paraRevisar > 0
        : filtro === "sem"
          ? p.consultas === 0
          : true) &&
      (busca === "" || normalizarParaBusca(p.nome).includes(busca)),
  );

  const chip = (valor: Filtro, rotulo: string) => (
    <button
      type="button"
      aria-pressed={filtro === valor}
      onClick={() => setFiltro(valor)}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-semibold transition-colors ${
        filtro === valor
          ? "vidro-polido border-white/95 text-tinta"
          : "border-tinta/10 text-grafite hover:border-tinta/20 hover:text-tinta"
      }`}
    >
      {rotulo}
      <span className="font-medium text-nevoa">{contagem[valor]}</span>
    </button>
  );

  return (
    <section
      aria-label="Lista de pacientes"
      className="vidro flex flex-col gap-3.5 rounded-[30px] p-4"
    >
      <label className="flex h-[50px] items-center gap-2.5 rounded-full border border-tinta/[0.08] bg-white/80 px-4.5 text-nevoa shadow-[inset_0_1px_2px_rgb(15_27_36/0.04)] focus-within:border-viva/70 focus-within:shadow-[0_0_0_4px_rgb(43_181_172/0.18)]">
        <IconeBusca tamanho={19} />
        <span className="sr-only">Buscar paciente pelo nome</span>
        <input
          type="search"
          value={termo}
          onChange={(e) => buscar(e.target.value)}
          placeholder="Buscar pelo nome"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-tinta outline-none placeholder:text-[#66747f]"
        />
      </label>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar pacientes">
        {chip("todos", "Todos")}
        {chip("revisar", "Para revisar")}
        {chip("sem", "Sem consulta")}
      </div>

      {visiveis.length === 0 ? (
        <p className="px-3 py-3 text-[14.5px] leading-relaxed text-grafite">
          {pacientes.length === 0
            ? "Ninguém cadastrado ainda. Use “Novo paciente” para começar."
            : "Ninguém com esse nome. Confira a grafia ou cadastre um novo paciente."}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {visiveis.map((p) => {
            const selecionado = p.id === aberto;
            return (
              <li key={p.id}>
                <Link
                  href={`/pacientes/${p.id}`}
                  aria-current={selecionado ? "page" : undefined}
                  className={`flex min-h-16 items-center gap-3 rounded-[18px] border px-3 py-2.5 text-tinta no-underline transition-colors ${
                    selecionado
                      ? "vidro-polido border-white/95"
                      : "border-transparent hover:bg-white/70"
                  }`}
                >
                  <Avatar nome={p.nome} chave={p.id} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[15px] font-semibold">{p.nome}</span>
                    <span className="text-[13px] text-nevoa">
                      {p.consultas === 0 || p.ultima === null
                        ? "ainda sem consulta"
                        : `${haQuanto(new Date(p.ultima), referencia)} · ${p.consultas} ${
                            p.consultas === 1 ? "consulta" : "consultas"
                          }`}
                    </span>
                  </span>
                  {p.paraRevisar > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-aviso">
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full bg-aviso-ponto"
                      />
                      revisar
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Lista e pasta lado a lado no computador; uma de cada vez no celular.
 *
 * Com uma pasta aberta, o celular mostra só a pasta (com o caminho de volta
 * no topo dela); sem pasta, só a lista. Decidido aqui pelo endereço, porque o
 * layout que monta as duas não recebe o endereço.
 */
export function DivisaoDePacientes({
  cabecalho,
  lista,
  children,
}: {
  cabecalho: React.ReactNode;
  lista: React.ReactNode;
  children: React.ReactNode;
}) {
  const caminho = usePathname();
  const aberto = caminho !== "/pacientes";

  return (
    <div className="flex flex-col gap-6">
      {/* No celular, com a pasta aberta, o título é o nome da pessoa. */}
      <div className={aberto ? "hidden lg:block" : "block"}>{cabecalho}</div>
      <div className="flex items-start gap-6">
        <div
          className={`w-full lg:sticky lg:top-5 lg:block lg:w-[400px] lg:shrink-0 ${
            aberto ? "hidden" : "block"
          }`}
        >
          {lista}
        </div>
        <div className={`min-w-0 flex-1 lg:block ${aberto ? "block" : "hidden"}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
