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
    <div className="w-full max-w-[440px] rounded-3xl border border-dashed border-tinta/20 bg-white/40 px-5 py-4">
      <p className="rotulo">Só em desenvolvimento</p>
      <button
        type="button"
        onClick={() => void entrar()}
        disabled={enviando}
        className="botao-vidro botao-pequeno w-full"
      >
        {enviando ? "Entrando…" : "Entrar como Ana (teste)"}
      </button>
      <p className="legenda mt-2">
        {conta.email} · senha <code className="text-tinta">{conta.senha}</code>
      </p>
      {erro !== null && (
        <p role="alert" className="alerta alerta-erro mt-2">
          {erro}
        </p>
      )}
    </div>
  );
}
