import { patients, sessions } from "@scribe/db";
import { count } from "drizzle-orm";
import Link from "next/link";

import { ExcluirConta } from "@/components/ExcluirConta";
import { IconeAvancar, IconeExportar } from "@/components/Icones";
import { asCurrentUser, exigirProfissional } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Os direitos do titular, numa tela só.
 *
 * A ordem na página é a ordem certa de exercê-los: **levar antes de apagar.**
 * Exclusão embaixo, discreta, atrás de um clique — não porque seja secundária,
 * mas porque é irreversível e não pode disputar atenção com a ação de que
 * ninguém se arrepende.
 */
export default async function Dados() {
  const me = await exigirProfissional();

  const totais = (await asCurrentUser(async (tx) => {
    const [p] = await tx.select({ n: count() }).from(patients);
    const [s] = await tx.select({ n: count() }).from(sessions);
    return { pacientes: p?.n ?? 0, consultas: s?.n ?? 0 };
  }).catch(() => null)) ?? { pacientes: 0, consultas: 0 };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <nav
          aria-label="Caminho"
          className="flex items-center gap-1.5 text-sm text-grafite"
        >
          <Link
            href="/configuracoes"
            className="text-grafite no-underline hover:text-tinta"
          >
            Ajustes
          </Link>
          <IconeAvancar tamanho={14} className="text-nevoa" />
          <span className="text-tinta">Seus dados</span>
        </nav>
        <h1 className="titulo-pagina">Seus dados</h1>
        <p className="text-[15.5px] text-grafite">
          Os direitos que a LGPD (Art. 18) dá a você sobre o que está guardado aqui.
        </p>
      </header>

      <section className="vidro flex flex-col gap-3 rounded-[26px] px-6 py-6">
        <h2 className="titulo-secao">Levar seus dados</h2>
        <p className="text-[15px] leading-relaxed text-grafite">
          Um arquivo JSON com o seu perfil, {totais.pacientes}{" "}
          {totais.pacientes === 1 ? "paciente" : "pacientes"}, {totais.consultas}{" "}
          {totais.consultas === 1 ? "consulta" : "consultas"}, as transcrições, os
          documentos gerados, o consumo e a trilha de auditoria. Legível por máquina e
          por gente.
        </p>
        <p className="legenda">
          O áudio das consultas não vai junto: são megabytes por consulta. Para levar um
          áudio específico, abra a consulta e baixe de lá.
        </p>

        {/*
         * Um link, e não `fetch` com download programático: o navegador cuida
         * do nome, do progresso e do gerenciador de downloads sozinho.
         */}
        <a href="/api/meus-dados" className="botao-principal mt-2 self-start">
          Baixar meus dados
          <span className="botao-icone" aria-hidden="true">
            <IconeExportar tamanho={18} />
          </span>
        </a>
      </section>

      <section className="vidro flex flex-col gap-3 rounded-[26px] px-6 py-6">
        <h2 className="titulo-secao">O que fazemos com o que está aqui</h2>
        <ul className="flex flex-col gap-2.5 text-[15px] leading-relaxed text-grafite">
          <li className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-2.5 size-1.5 shrink-0 rounded-full bg-viva"
            />
            <span>
              O áudio é processado para produzir a sua documentação, e mais nada. Ele{" "}
              <strong className="font-semibold text-tinta">
                não treina nenhuma IA
              </strong>
              .
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-2.5 size-1.5 shrink-0 rounded-full bg-viva"
            />
            <span>
              No motor <code>local</code>, o áudio não sai do servidor: nenhum
              fornecedor externo, nenhum subprocessador.
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-2.5 size-1.5 shrink-0 rounded-full bg-viva"
            />
            <span>
              O áudio é apagado automaticamente depois do prazo de retenção configurado,
              por minimização (LGPD, Art. 6º).
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-2.5 size-1.5 shrink-0 rounded-full bg-viva"
            />
            <span>
              A trilha de auditoria registra IDs e horários, nunca o conteúdo das
              consultas.{" "}
              <Link href="/auditoria" className="botao-texto">
                Ver a minha
              </Link>
            </span>
          </li>
        </ul>
      </section>

      <section className="mt-4 flex flex-col gap-3">
        <ExcluirConta consultas={totais.consultas} />
        <p className="legenda">Conta de {me.email ?? me.name}.</p>
      </section>
    </div>
  );
}
