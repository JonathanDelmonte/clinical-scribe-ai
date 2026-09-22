import { patients, sessions } from "@scribe/db";
import { count } from "drizzle-orm";
import Link from "next/link";

import { ExcluirConta } from "@/components/ExcluirConta";
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
    <main className="mx-auto max-w-3xl px-5 py-10">
      <nav className="mb-6 text-sm text-muted">
        <Link href="/configuracoes" className="hover:text-ink">
          ← configurações
        </Link>
      </nav>

      <h1 className="text-2xl font-semibold tracking-tight">Seus dados</h1>
      <p className="mt-1 mb-8 text-sm text-muted">
        Os direitos que a LGPD (Art. 18) dá a você sobre o que está guardado aqui.
      </p>

      <section className="rounded-lg border border-line px-5 py-4">
        <h2 className="font-medium">Levar seus dados</h2>
        <p className="mt-2 text-sm text-muted">
          Um arquivo JSON com o seu perfil, {totais.pacientes}{" "}
          {totais.pacientes === 1 ? "paciente" : "pacientes"}, {totais.consultas}{" "}
          {totais.consultas === 1 ? "consulta" : "consultas"}, as transcrições, os
          documentos gerados, o consumo e a trilha de auditoria. Legível por máquina e
          por gente.
        </p>
        <p className="mt-2 text-xs text-muted">
          O áudio das consultas não vai junto — são megabytes por consulta. Para levar
          um áudio específico, abra a consulta e baixe de lá.
        </p>

        {/*
         * Um link, e não `fetch` com download programático: o navegador cuida
         * do nome, do progresso e do gerenciador de downloads sozinho.
         */}
        <a
          href="/api/meus-dados"
          className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface"
        >
          Baixar meus dados
        </a>
      </section>

      <section className="mt-6 rounded-lg border border-line px-5 py-4">
        <h2 className="font-medium">O que fazemos com o que está aqui</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          <li>
            • O áudio é processado para produzir a sua documentação, e mais nada. Ele{" "}
            <strong className="text-ink">não treina nenhuma IA</strong>.
          </li>
          <li>
            • No motor <code>local</code>, o áudio não sai do servidor: nenhum
            fornecedor externo, nenhum subprocessador.
          </li>
          <li>
            • O áudio é apagado automaticamente depois do prazo de retenção configurado
            — minimização, LGPD Art. 6º.
          </li>
          <li>
            • A trilha de auditoria registra IDs e horários, nunca o conteúdo das
            consultas.{" "}
            <Link href="/auditoria" className="text-accent hover:underline">
              ver a minha
            </Link>
          </li>
        </ul>
      </section>

      <section className="mt-10">
        <ExcluirConta consultas={totais.consultas} />
      </section>

      <p className="mt-6 text-xs text-muted">Conta de {me.email ?? me.name}.</p>
    </main>
  );
}
