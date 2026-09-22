"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Sair.
 *
 * Um `fetch` com `POST` em vez de um link: `GET` que encerra sessão é
 * derrubado por qualquer imagem apontando para a rota numa página de terceiro.
 *
 * `router.replace` depois, e não `push`: o histórico do navegador não pode
 * oferecer "voltar" para uma tela que mostrava dado de paciente. No aparelho
 * compartilhado do consultório, é a diferença entre sair e parecer que saiu.
 */
export function SairButton() {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    if (saindo) return;
    setSaindo(true);
    try {
      await fetch("/api/auth/sair", { method: "POST" });
    } finally {
      router.replace("/entrar");
      router.refresh();
    }
  }

  return (
    <button
      onClick={() => void sair()}
      disabled={saindo}
      className="text-xs text-muted hover:text-ink disabled:opacity-50"
    >
      sair
    </button>
  );
}
