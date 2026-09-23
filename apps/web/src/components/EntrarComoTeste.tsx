"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CONTA_DE_TESTE } from "@/lib/conta-de-teste";

/**
 * Entrar na conta de teste com um clique.
 *
 * ## Por que usa o login de verdade, e não uma rota que entra sem senha
 *
 * Uma rota "entrar sem senha, só em desenvolvimento" seria mais limpa — nenhuma
 * senha no navegador. E falharia do pior jeito possível: se a proteção de
 * ambiente escapasse uma única vez, qualquer pessoa entraria em qualquer conta.
 *
 * Usando o login normal, o pior caso é outro: o botão aparece por engano em
 * produção, alguém clica, e a conta `ana@consultaviva.local` não existe lá. O
 * login falha como falharia com qualquer senha errada. Uma escolha falha
 * catastroficamente; a outra falha em silêncio e sem dano.
 *
 * E há um ganho de brinde: cada clique neste botão exercita o caminho real de
 * login — limite de tentativas, auditoria, cookie — em vez de um atalho que
 * deixaria o caminho real sem uso durante todo o desenvolvimento.
 */
export function EntrarComoTeste({ destino }: { destino: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (CONTA_DE_TESTE === null) return null;
  const conta = CONTA_DE_TESTE;

  async function entrar() {
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await fetch("/api/auth/entrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(conta),
      });
      if (!resposta.ok) {
        // O caso real aqui é o banco local sem a conta: alguém recriou o banco
        // e não rodou o seed. Dizer o comando economiza a investigação.
        setErro(
          "A conta de teste não existe neste banco. Rode `pnpm db:seed` e tente de novo.",
        );
        return;
      }
      router.replace(destino);
      router.refresh();
    } catch {
      setErro("Sem conexão com o servidor.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-8 rounded-lg border border-dashed border-line px-4 py-3">
      <p className="mb-2 text-xs tracking-widest text-muted uppercase">
        Só em desenvolvimento
      </p>
      <button
        onClick={() => void entrar()}
        disabled={enviando}
        className="w-full rounded-lg border border-line px-4 py-2.5 text-sm hover:border-accent hover:text-accent disabled:opacity-40"
      >
        {enviando ? "entrando…" : "Entrar como Ana (teste)"}
      </button>
      <p className="mt-2 text-xs text-muted">
        {conta.email} · senha <code className="text-ink">{conta.senha}</code>
      </p>
      {erro !== null && (
        <p role="alert" className="mt-2 text-xs text-red-500">
          {erro}
        </p>
      )}
    </div>
  );
}
