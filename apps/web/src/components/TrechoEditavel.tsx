"use client";

import { useState } from "react";

import { IconeTocar } from "./Icones";
import { ROLE_LABEL } from "./SpeakerRoles";

export interface TrechoCorrigivel {
  id: string;
  speakerLabel: string;
  role: string;
  startMs: number;
  endMs: number;
  text: string;
  textOriginal?: string | null;
  roleOriginal?: string | null;
  correctedAt?: string | null;
}

/**
 * Os papéis que alguém escolhe à mão.
 *
 * `unknown` fica de fora de propósito: é o que a máquina diz quando não sabe,
 * e uma pessoa que está corrigindo justamente sabe. Oferecer "não
 * identificado" seria oferecer desistir.
 */
const PAPEIS = ["professional", "patient", "other"] as const;

interface Props {
  sessionId: string;
  trecho: TrechoCorrigivel;
  destacado: boolean;
  timestamp: string;
  onOuvir: () => void;
  onCorrigido: (mensagem: string) => void;
}

/**
 * Um trecho da transcrição que pode ser consertado — o texto e quem falou.
 *
 * ## As duas correções não são a mesma coisa
 *
 * Consertar o TEXTO arruma o que o reconhecimento ouviu errado: "azar" por
 * "arder". Consertar o FALANTE arruma a separação de vozes — e esse é o erro
 * mais caro dos dois, porque inverte o sentido do registro. "Qual dor você
 * está sentindo?" atribuído ao paciente não é uma palavra errada: é uma
 * pergunta do médico virando queixa de quem responde, e a nota gerada em cima
 * disso fica coerente e ao contrário.
 *
 * ## Por que salvar é um clique, e não automático
 *
 * Salvar a cada tecla gravaria "ard", "arde", "arder" como três correções, e
 * sujaria exatamente o dado que a correção existe para produzir — o par entre
 * o que a máquina ouviu e o que era de verdade. O clique também dá o instante
 * em que cabe dizer obrigado, que é o que faz a pessoa corrigir o próximo.
 */
export function TrechoEditavel({
  sessionId,
  trecho,
  destacado,
  timestamp,
  onOuvir,
  onCorrigido,
}: Props) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(trecho.text);
  const [escolhendoPapel, setEscolhendoPapel] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const corrigido = trecho.correctedAt != null;

  async function enviar(mudanca: { text?: string; role?: string }, oQue: string) {
    setSalvando(true);
    setErro(null);
    const res = await fetch(`/api/sessions/${sessionId}/segments/${trecho.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mudanca),
    });
    setSalvando(false);

    if (!res.ok) {
      const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
      setErro(corpo?.error ?? "não foi possível salvar a correção");
      return;
    }
    setEditando(false);
    setEscolhendoPapel(false);
    onCorrigido(oQue);
  }

  /** A cor de quem fala — a mesma da fita na hélice. */
  const corDoPapel =
    trecho.role === "professional"
      ? "text-viva-texto"
      : trecho.role === "patient"
        ? "text-pessego-texto"
        : trecho.role === "unknown"
          ? "text-nevoa italic"
          : "text-grafite";

  return (
    <li
      id={`trecho-${trecho.id}`}
      className={`group scroll-mt-24 rounded-2xl border px-3 py-2.5 transition-colors ${
        destacado
          ? "border-viva/35 bg-viva-claro/75"
          : "border-transparent hover:bg-white/60"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        {/*
         * O papel é um botão, não um rótulo.
         *
         * A separação de vozes erra, e o conserto precisa estar onde o erro
         * aparece. Uma tela separada de "corrigir falantes" seria um lugar
         * onde ninguém vai: quem percebe o erro está lendo a transcrição,
         * nesta linha, agora.
         */}
        {escolhendoPapel ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {PAPEIS.filter((p) => p !== trecho.role).map((p) => (
              <button
                key={p}
                type="button"
                disabled={salvando}
                onClick={() => void enviar({ role: p }, "falante corrigido")}
                className="rounded-full bg-viva/15 px-2.5 py-1 font-semibold text-viva-texto hover:bg-viva/25 disabled:opacity-40"
              >
                {ROLE_LABEL[p]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setEscolhendoPapel(false)}
              className="botao-texto text-[12.5px]"
            >
              cancelar
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setEscolhendoPapel(true)}
            title={`${trecho.speakerLabel}: clique para corrigir quem falou`}
            className={`font-semibold underline-offset-2 hover:underline ${corDoPapel}`}
          >
            {ROLE_LABEL[trecho.role] ?? trecho.speakerLabel}
            {corrigido && <span className="ml-1 text-viva-texto">✓</span>}
          </button>
        )}

        <button
          type="button"
          onClick={onOuvir}
          title="ouvir este trecho"
          className="inline-flex items-center gap-1 text-nevoa tabular-nums hover:text-viva-texto"
        >
          <IconeTocar tamanho={10} />
          {timestamp}
        </button>
      </div>

      {editando ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            rows={2}
            autoFocus
            className="campo text-[14.5px]"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={salvando || rascunho.trim() === ""}
              onClick={() => void enviar({ text: rascunho }, "correção salva")}
              className="botao-principal botao-pequeno"
            >
              {salvando ? "Salvando…" : "Salvar correção"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRascunho(trecho.text);
                setEditando(false);
                setErro(null);
              }}
              className="botao-texto"
            >
              cancelar
            </button>
            {trecho.textOriginal != null && (
              <span title={trecho.textOriginal} className="legenda truncate">
                a máquina ouviu: &ldquo;{trecho.textOriginal}&rdquo;
              </span>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setRascunho(trecho.text);
            setEditando(true);
          }}
          title="clique para corrigir o texto"
          className="mt-0.5 w-full cursor-text text-left text-[14.5px] leading-relaxed text-tinta"
        >
          {trecho.text}
        </button>
      )}

      {erro !== null && (
        <p role="alert" className="mt-1 text-[12.5px] text-erro">
          {erro}
        </p>
      )}
    </li>
  );
}
