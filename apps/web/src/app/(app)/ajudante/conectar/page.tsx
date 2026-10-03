import Link from "next/link";

import { IconeCheck, IconeEscudo } from "@/components/Icones";
import { lerPedidoDeConexao } from "@/lib/ajudante/conexao";
import { exigirSessao } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Conectar o ajudante de um computador à conta (ADR-0005).
 *
 * O ajudante abre esta página no navegador; quem decide é a pessoa, já dentro
 * da própria conta — o programa nunca vê a senha. "Conectar" assina um convite
 * e o devolve ao ajudante pelo endereço local do computador (ver
 * `api/ajudante/convite`).
 */
export default async function ConectarAjudante({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Sessão, e não perfil completo: conectar o computador antes de terminar o
  // cadastro inicial não pode mandar a pessoa para `/bem-vindo` e perder a volta.
  const eu = await exigirSessao();
  const p = await searchParams;
  const pedido = lerPedidoDeConexao({
    porta: p["porta"],
    estado: p["estado"],
    desafio: p["desafio"],
    nome: p["nome"],
  });

  if (pedido === null) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <h1 className="titulo-pagina">Este link de conexão não vale</h1>
        <p className="text-[15.5px] leading-relaxed text-grafite">
          Ele chegou incompleto ou foi copiado de outro lugar. Abra o ajudante no
          computador que você quer conectar e escolha &quot;Conectar à sua conta&quot;
          de novo.
        </p>
        <Link
          href="/configuracoes#ajudante"
          className="botao-vidro self-start no-underline"
        >
          Ver o ajudante nos ajustes
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="titulo-pagina">Conectar este computador?</h1>
        <p className="text-[15.5px] leading-relaxed text-grafite">
          O ajudante de{" "}
          <strong className="font-semibold text-tinta">{pedido.nome}</strong> quer
          processar as consultas da conta de{" "}
          <strong className="font-semibold text-tinta">{eu.name}</strong>
          {eu.email === null ? "" : ` (${eu.email})`}.
        </p>
      </header>

      <section className="vidro flex flex-col gap-4 rounded-[26px] px-6 py-6">
        <ul className="flex flex-col gap-3 text-[15px] leading-relaxed text-grafite">
          <li className="flex items-start gap-3">
            <IconeCheck tamanho={18} className="mt-1 shrink-0 text-viva-texto" />
            Enquanto o ajudante estiver ligado, as suas consultas são transcritas nele,
            e não na estação da equipe.
          </li>
          <li className="flex items-start gap-3">
            <IconeCheck tamanho={18} className="mt-1 shrink-0 text-viva-texto" />O
            cadastro da sua voz passa a funcionar a qualquer hora.
          </li>
          <li className="flex items-start gap-3">
            <IconeEscudo tamanho={18} className="mt-1 shrink-0 text-viva-texto" />O
            programa não recebe a sua senha nem chave nenhuma. Você desconecta quando
            quiser, nos ajustes.
          </li>
        </ul>

        <form
          method="post"
          action="/api/ajudante/convite"
          className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2"
        >
          <input type="hidden" name="porta" value={pedido.porta} />
          <input type="hidden" name="estado" value={pedido.estado} />
          <input type="hidden" name="desafio" value={pedido.desafio} />
          <input type="hidden" name="nome" value={pedido.nome} />
          <button type="submit" className="botao-principal">
            Conectar
            <span className="botao-icone" aria-hidden="true">
              <IconeCheck tamanho={18} traco={2.2} />
            </span>
          </button>
          <Link href="/" className="botao-texto">
            Agora não
          </Link>
        </form>
      </section>

      <p className="text-[13.5px] leading-relaxed text-nevoa">
        Não foi você que abriu esta página pelo ajudante? Então não conecte: feche esta
        aba.
      </p>
    </div>
  );
}
