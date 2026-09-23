"use client";

import { useState } from "react";

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

  return (
    <li
      id={`trecho-${trecho.id}`}
      className={`group rounded-md text-sm transition-colors ${
        destacado ? "-mx-2 bg-accent/15 px-2 py-1" : ""
      }`}
    >
      <div className="flex gap-3">
        <button
          onClick={onOuvir}
          title="ouvir este trecho"
          className="w-12 shrink-0 cursor-pointer text-left font-mono text-xs text-muted tabular-nums hover:text-accent"
        >
          {timestamp}
        </button>

        {/*
         * O papel é um botão, não um rótulo.
         *
         * A separação de vozes erra, e o conserto precisa estar onde o erro
         * aparece. Uma tela separada de "corrigir falantes" seria um lugar
         * onde ninguém vai: quem percebe o erro está lendo a transcrição,
         * nesta linha, agora.
         */}
        <div className="w-24 shrink-0">
          {escolhendoPapel ? (
            <div className="flex flex-col gap-0.5">
              {PAPEIS.filter((p) => p !== trecho.role).map((p) => (
                <button
                  key={p}
                  disabled={salvando}
                  onClick={() => void enviar({ role: p }, "falante corrigido")}
                  className="rounded bg-accent/15 px-1.5 py-0.5 text-left text-xs text-accent hover:bg-accent/25 disabled:opacity-40"
                >
                  {ROLE_LABEL[p]}
                </button>
              ))}
              <button
                onClick={() => setEscolhendoPapel(false)}
                className="px-1.5 text-left text-xs text-muted hover:text-ink"
              >
                cancelar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEscolhendoPapel(true)}
              title={`${trecho.speakerLabel} — clique para corrigir quem falou`}
              className={`text-left text-xs underline-offset-2 hover:underline ${
                trecho.role === "professional"
                  ? "font-medium text-accent"
                  : trecho.role === "unknown"
                    ? "text-muted/60 italic"
                    : "text-muted"
              }`}
            >
              {ROLE_LABEL[trecho.role] ?? trecho.speakerLabel}
              {corrigido && <span className="ml-1 text-accent">✓</span>}
            </button>
          )}
        </div>

        {editando ? (
          <div className="min-w-0 flex-1 space-y-2">
            <textarea
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              rows={2}
              autoFocus
              className="w-full rounded-md border border-accent bg-transparent px-2 py-1 text-sm"
            />
            <div className="flex items-center gap-2">
              <button
                disabled={salvando || rascunho.trim() === ""}
                onClick={() => void enviar({ text: rascunho }, "correção salva")}
                className="rounded bg-accent px-3 py-1 text-xs font-medium text-surface disabled:opacity-40"
              >
                {salvando ? "salvando…" : "Salvar correção"}
              </button>
              <button
                onClick={() => {
                  setRascunho(trecho.text);
                  setEditando(false);
                  setErro(null);
                }}
                className="text-xs text-muted hover:text-ink"
              >
                cancelar
              </button>
              {trecho.textOriginal != null && (
                <span
                  title={trecho.textOriginal}
                  className="truncate text-xs text-muted"
                >
                  a máquina ouviu: &ldquo;{trecho.textOriginal}&rdquo;
                </span>
              )}
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              setRascunho(trecho.text);
              setEditando(true);
            }}
            title="clique para corrigir o texto"
            className="min-w-0 flex-1 cursor-text rounded px-1 text-left hover:bg-accent/5"
          >
            {trecho.text}
          </button>
        )}
      </div>

      {erro !== null && (
        <p role="alert" className="mt-1 pl-[5.5rem] text-xs text-red-500">
          {erro}
        </p>
      )}
    </li>
  );
}
