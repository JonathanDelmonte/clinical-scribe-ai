"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const PALAVRA = "EXCLUIR";

/**
 * Excluir a conta — LGPD Art. 18, VI.
 *
 * Três barreiras, e nenhuma é excesso de zelo:
 *
 * 1. **Abrir a seção** é um clique separado. Um botão vermelho permanente ao
 *    lado de "baixar meus dados" é um botão que alguém erra no celular.
 * 2. **Digitar a palavra**, não confirmar num diálogo. "Tem certeza?" com dois
 *    botões é clicado no automático; digitar obriga a parar.
 * 3. **O aviso sobre guarda de prontuário** aparece antes de tudo. É a
 *    informação que a pessoa provavelmente não tem, e é a que pode fazer ela
 *    mudar de ideia por um motivo legítimo.
 */
export function ExcluirConta({ consultas }: { consultas: number }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function excluir() {
    if (texto !== PALAVRA || ocupado) return;

    setOcupado(true);
    setErro(null);
    try {
      const resposta = await fetch("/api/conta", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacao: PALAVRA }),
      });

      if (!resposta.ok) {
        const corpo: unknown = await resposta.json().catch(() => null);
        setErro(
          typeof corpo === "object" && corpo !== null && "error" in corpo
            ? String((corpo as { error: unknown }).error)
            : "não foi possível excluir a conta",
        );
        return;
      }

      router.replace("/entrar");
      router.refresh();
    } catch {
      setErro("sem conexão com o servidor");
    } finally {
      setOcupado(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="text-sm text-muted underline underline-offset-2 hover:text-red-500"
      >
        excluir minha conta
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-red-500/40 px-5 py-4">
      <h3 className="font-medium text-red-500">Excluir a conta</h3>

      <p className="mt-3 text-sm">
        Apaga a sua conta,{" "}
        {consultas === 0 ? "" : `as ${consultas} consultas gravadas, `}
        os pacientes, as transcrições, as notas e os áudios. Imediatamente e sem
        desfazer.
      </p>

      {/*
       * O aviso que muda decisões. A Resolução CFM 1.821/2007 trata da guarda
       * do prontuário, e é bem provável que a pessoa não tenha isso em mente ao
       * clicar — dizer antes é mais útil que qualquer confirmação a mais.
       */}
      <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
        <strong>Antes de continuar:</strong> a documentação clínica que você produziu
        aqui pode estar sujeita a prazo de guarda (Resolução CFM 1.821/2007). Baixe seus
        dados e arquive o que precisar — depois desta ação não há como recuperar.
      </p>

      <p className="mt-3 text-sm text-muted">
        A trilha de auditoria é preservada — é o registro de que a conta existiu e foi
        apagada. O que identificava você nela (endereço de IP e navegador) é anulado no
        mesmo instante; sobram as ações e seus horários.
      </p>

      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium tracking-widest text-muted uppercase">
          Digite {PALAVRA} para confirmar
        </span>
        <input
          className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label={`Digite ${PALAVRA} para confirmar`}
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void excluir()}
          disabled={texto !== PALAVRA || ocupado}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {ocupado ? "Excluindo…" : "Excluir definitivamente"}
        </button>
        <button
          onClick={() => {
            setAberto(false);
            setTexto("");
            setErro(null);
          }}
          className="text-sm text-muted underline underline-offset-2 hover:text-ink"
        >
          cancelar
        </button>
      </div>

      {erro !== null && (
        <p role="alert" className="mt-3 text-sm text-red-500">
          {erro}
        </p>
      )}
    </div>
  );
}
