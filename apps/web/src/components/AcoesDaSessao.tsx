"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Parar e apagar uma consulta.
 *
 * As duas ações que faltavam nas duas telas onde uma consulta aparece: a
 * página dela e a lista da pasta do paciente. O mesmo componente serve as
 * duas — `compacto` muda a aparência, nunca o comportamento. Um "apagar" que
 * pede confirmação numa tela e não pede na outra é o tipo de inconsistência
 * que custa uma consulta.
 */

/** Estados em que ainda há trabalho para interromper. Espelha `lib/sessoes.ts`. */
const EM_ANDAMENTO = new Set(["uploaded", "transcribing", "generating"]);

/** Estados em que apagar joga fora documentação clínica, e não um upload errado. */
const COM_CONTEUDO_CLINICO = new Set(["ready_for_review", "approved"]);

export function AcoesDaSessao({
  sessionId,
  patientId,
  status,
  compacto = false,
}: {
  sessionId: string;
  patientId: string;
  status: string;
  /** Na lista da pasta: links discretos em vez de botões. */
  compacto?: boolean;
}) {
  const router = useRouter();

  const [ocupado, setOcupado] = useState<null | "cancelar" | "apagar">(null);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const emAndamento = EM_ANDAMENTO.has(status);
  const clinica = COM_CONTEUDO_CLINICO.has(status);

  async function cancelar() {
    setOcupado("cancelar");
    setErro(null);
    setAviso(null);

    const resposta = await fetch(`/api/sessions/${sessionId}/cancelar`, {
      method: "POST",
    }).catch(() => null);

    if (resposta === null || !resposta.ok) {
      const corpo = (await resposta?.json().catch(() => null)) as {
        error?: string;
      } | null;
      setErro(corpo?.error ?? "não foi possível cancelar");
      setOcupado(null);
      /**
       * Recarrega mesmo tendo falhado.
       *
       * O motivo mais provável de um cancelamento ser recusado é que não há
       * mais o que cancelar — a transcrição terminou entre o carregamento da
       * página e o clique. Recarregar tira o botão de cena em vez de deixar
       * a pessoa clicando num botão que nunca mais vai funcionar.
       */
      router.refresh();
      return;
    }

    const corpo = (await resposta.json().catch(() => null)) as {
      haviaRodando?: boolean;
    } | null;

    /**
     * O aviso só aparece quando é verdade, e diz a verdade inteira.
     *
     * Um job que já estava rodando vive noutro processo, com o modelo de
     * transcrição carregado — nenhuma requisição daqui o mata. Ele para de
     * ser retomado, mas pode terminar o que começou e gravar o resultado.
     * Esconder isso faria a tela prometer um cancelamento que ela não tem
     * como cumprir, e a pessoa descobriria sozinha, do pior jeito: vendo a
     * consulta que mandou parar voltar pronta.
     */
    if (corpo?.haviaRodando === true) {
      setAviso(
        "Processamento interrompido. A etapa que já estava em curso no " +
          "servidor pode terminar mesmo assim — se a consulta voltar a " +
          "aparecer processada, é isso.",
      );
    }

    setOcupado(null);
    router.refresh();
  }

  async function apagar() {
    if (!confirmando) {
      setConfirmando(true);
      setErro(null);
      return;
    }

    setOcupado("apagar");
    setErro(null);

    const resposta = await fetch(`/api/sessions/${sessionId}?confirmar=1`, {
      method: "DELETE",
    }).catch(() => null);

    if (resposta === null || !resposta.ok) {
      const corpo = (await resposta?.json().catch(() => null)) as {
        error?: string;
      } | null;
      setErro(corpo?.error ?? "não foi possível apagar");
      setOcupado(null);
      setConfirmando(false);
      return;
    }

    // Sair da página da consulta que acabou de deixar de existir. Na lista,
    // basta recarregar — a linha some sozinha.
    if (compacto) {
      router.refresh();
    } else {
      router.push(`/pacientes/${patientId}`);
      router.refresh();
    }
  }

  const ocupadoAgora = ocupado !== null;

  const botaoCancelar = compacto
    ? "text-sm text-muted underline underline-offset-2 hover:text-ink disabled:opacity-40"
    : "rounded-lg border border-line px-4 py-2 text-sm hover:border-accent disabled:opacity-40";

  const botaoApagar = confirmando
    ? compacto
      ? "text-sm font-medium text-red-500 underline underline-offset-2 disabled:opacity-40"
      : "rounded-lg bg-red-500/15 px-4 py-2 text-sm font-medium text-red-500 disabled:opacity-40"
    : compacto
      ? "text-sm text-muted underline underline-offset-2 hover:text-red-500 disabled:opacity-40"
      : "rounded-lg px-4 py-2 text-sm text-muted underline underline-offset-2 hover:text-red-500 disabled:opacity-40";

  return (
    <div className={compacto ? "contents" : "space-y-2"}>
      <div className="flex flex-wrap items-center gap-3">
        {emAndamento && (
          <button
            onClick={() => void cancelar()}
            disabled={ocupadoAgora}
            className={botaoCancelar}
          >
            {ocupado === "cancelar" ? "cancelando…" : "Cancelar processamento"}
          </button>
        )}

        {/*
         * Apagar fica depois de cancelar, e discreto até a confirmação.
         *
         * São a saída normal e a saída destrutiva lado a lado. Quem só quer
         * parar não pode esbarrar em quem destrói — e quem quer destruir
         * procura, encontra, e confirma.
         */}
        <button
          onClick={() => void apagar()}
          disabled={ocupadoAgora}
          className={botaoApagar}
        >
          {ocupado === "apagar"
            ? "apagando…"
            : confirmando
              ? clinica
                ? "Confirmar: apagar consulta e transcrição"
                : "Confirmar: apagar consulta"
              : "apagar"}
        </button>

        {confirmando && ocupado === null && (
          <button
            onClick={() => setConfirmando(false)}
            className="text-sm text-muted underline underline-offset-2 hover:text-ink"
          >
            não apagar
          </button>
        )}
      </div>

      {/*
       * O aviso sobre prontuário aparece na confirmação, e só quando é o
       * caso. Uma consulta transcrita é documentação clínica, e quem responde
       * pela guarda dela é o profissional — a tela não decide por ele, mas
       * também não deixa a decisão acontecer sem a informação.
       */}
      {confirmando && !compacto && (
        <p className="text-xs text-muted">
          {clinica
            ? "A gravação, a transcrição e a nota são apagadas e não há como desfazer. " +
              "Se precisa guardar o registro do atendimento, exporte antes."
            : "A gravação é apagada e não há como desfazer."}
        </p>
      )}

      {aviso !== null && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          {aviso}
        </p>
      )}
      {erro !== null && (
        <p role="alert" className="text-sm text-red-500">
          {erro}
        </p>
      )}
    </div>
  );
}
