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
      <button onClick={() => setAberto(true)} className="botao-texto perigo">
        Excluir minha conta
      </button>
    );
  }

  return (
    <div className="vidro flex flex-col gap-4 rounded-[26px] border-erro/30 px-6 py-6">
      <h3 className="titulo-secao text-erro">Excluir a conta</h3>

      <p className="text-[15px] leading-relaxed">
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
      <p className="alerta alerta-aviso">
        <strong className="font-semibold">Antes de continuar:</strong> a documentação
        clínica que você produziu aqui pode estar sujeita a prazo de guarda (Resolução
        CFM 1.821/2007). Baixe seus dados e arquive o que precisar — depois desta ação
        não há como recuperar.
      </p>

      <p className="legenda text-[13.5px]">
        A trilha de auditoria é preservada — é o registro de que a conta existiu e foi
        apagada. O que identificava você nela (endereço de IP e navegador) é anulado no
        mesmo instante; sobram as ações e seus horários.
      </p>

      <label className="block">
        <span className="rotulo">Digite {PALAVRA} para confirmar</span>
        <input
          className="campo font-mono tracking-[0.08em]"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label={`Digite ${PALAVRA} para confirmar`}
        />
      </label>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          onClick={() => void excluir()}
          disabled={texto !== PALAVRA || ocupado}
          className="botao-perigo botao-pequeno"
        >
          {ocupado ? "Excluindo…" : "Excluir definitivamente"}
        </button>
        <button
          onClick={() => {
            setAberto(false);
            setTexto("");
            setErro(null);
          }}
          className="botao-texto"
        >
          Cancelar
        </button>
      </div>

      {erro !== null && (
        <p role="alert" className="alerta alerta-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
