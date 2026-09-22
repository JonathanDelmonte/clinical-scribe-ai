"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Busca de pacientes.
 *
 * O termo vive na URL, e não só no estado do componente. Isso é o que faz a
 * busca sobreviver ao recarregar, poder ser compartilhada e — o que importa no
 * consultório — continuar lá quando a pessoa volta da ficha de um paciente com
 * o botão de voltar.
 *
 * `replace` e não `push`: cada letra digitada viraria uma entrada no
 * histórico, e sair da tela custaria um toque em "voltar" por caractere.
 */
export function PatientSearch({ total }: { total: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inicial = searchParams.get("q") ?? "";

  const [termo, setTermo] = useState(inicial);
  const primeira = useRef(true);

  useEffect(() => {
    // Não navega na montagem: o servidor já renderizou com o termo da URL, e
    // um `replace` aqui dispararia uma segunda renderização idêntica.
    if (primeira.current) {
      primeira.current = false;
      return;
    }

    // Espera a digitação parar. Sem isto, "Ana Maria" dispara nove consultas
    // ao banco, e as respostas chegam fora de ordem — a tela pisca com
    // resultados de termos que a pessoa já terminou de apagar.
    const id = setTimeout(() => {
      const params = new URLSearchParams();
      if (termo.trim() !== "") params.set("q", termo.trim());
      router.replace(params.size === 0 ? "/" : `/?${params.toString()}`);
    }, 250);

    return () => clearTimeout(id);
  }, [termo, router]);

  return (
    <div>
      <label className="block">
        <span className="sr-only">Buscar paciente</span>
        <input
          type="search"
          className="w-full rounded-lg border border-line bg-transparent px-3 py-2.5 text-sm placeholder:text-muted"
          placeholder="Buscar paciente pelo nome…"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          autoComplete="off"
        />
      </label>
      {termo.trim() !== "" && (
        <p className="mt-2 text-xs text-muted">
          {total === 0
            ? "Nenhum paciente encontrado."
            : `${total} ${total === 1 ? "paciente" : "pacientes"} para “${termo.trim()}”.`}
        </p>
      )}
    </div>
  );
}
