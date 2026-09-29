"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { IconeSair } from "./Icones";

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
      type="button"
      onClick={() => void sair()}
      disabled={saindo}
      aria-label="Sair da conta"
      title="Sair da conta"
      className="botao-redondo disabled:opacity-50"
    >
      <IconeSair />
    </button>
  );
}
