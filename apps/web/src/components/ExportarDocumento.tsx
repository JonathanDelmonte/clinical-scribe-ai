"use client";

import { useState } from "react";

import { IconeCheck, IconeCopiar, IconeDocumento, IconeExportar } from "./Icones";

export interface DocumentoExportavel {
  /** `"nota"` ou o ID de um documento de objetivo. */
  readonly chave: string;
  readonly titulo: string;
  readonly aprovado: boolean;
  readonly criadoEm: string;
}

/**
 * Copiar para o prontuário, e baixar em PDF.
 *
 * O botão de copiar é a estratégia do MVP inteira (§10 da documentação): ser o
 * assistente que **exporta** para o prontuário certificado que o profissional
 * já usa, em vez de tentar ser o prontuário — o que exigiria certificação
 * SBIS/NGS2 antes do primeiro usuário.
 *
 * O texto é buscado do servidor na hora do clique, e não embutido na página.
 * Assim existe uma formatação só, a que o PDF também usa, e não duas que
 * divergem na primeira correção.
 */
export function ExportarDocumento({
  sessionId,
  documentos,
}: {
  sessionId: string;
  documentos: readonly DocumentoExportavel[];
}) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function copiar(doc: DocumentoExportavel) {
    setErro(null);
    try {
      const resposta = await fetch(
        `/api/sessions/${sessionId}/exportar?formato=texto&documento=${encodeURIComponent(doc.chave)}`,
      );
      if (!resposta.ok) {
        setErro("não foi possível gerar o texto");
        return;
      }
      const texto = await resposta.text();

      /**
       * `navigator.clipboard` exige contexto seguro e, em alguns navegadores,
       * um gesto recente do usuário. Quando falha — HTTP em rede local, Safari
       * antigo — o texto ainda precisa chegar a algum lugar, então ele vai
       * para uma nova aba, de onde dá para copiar à mão.
       */
      try {
        await navigator.clipboard.writeText(texto);
        setCopiado(doc.chave);
        setTimeout(() => setCopiado(null), 2500);
      } catch {
        const janela = window.open("", "_blank");
        if (janela === null) {
          setErro("libere as janelas deste site para ver o texto");
          return;
        }

        /**
         * Montado pelo DOM, com `textContent`, em vez de `document.write` com
         * o texto interpolado.
         *
         * A versão anterior escapava `<`, `>` e `&` à mão e estava correta —
         * mas escapar à mão é o tipo de coisa que continua correta até alguém
         * acrescentar um atributo, e o conteúdo aqui é uma nota clínica
         * produzida por um modelo de linguagem. `textContent` não tem como
         * interpretar nada como marcação.
         */
        const pre = janela.document.createElement("pre");
        pre.style.cssText =
          "white-space:pre-wrap;font:14px/1.5 system-ui,sans-serif;padding:24px;margin:0";
        pre.textContent = texto;
        janela.document.body.append(pre);
        janela.document.title = doc.titulo;
      }
    } catch {
      setErro("sem conexão com o servidor");
    }
  }

  if (documentos.length === 0) {
    return (
      <p className="vidro rounded-[22px] px-5 py-5 text-[15px] text-grafite">
        Esta consulta ainda não tem documentos gerados.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {documentos.map((doc) => (
        <div
          key={doc.chave}
          className="vidro flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[24px] px-5 py-4"
        >
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-viva-claro text-viva-texto"
          >
            <IconeDocumento tamanho={20} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[16px] font-semibold">{doc.titulo}</span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-nevoa">
              <span className={`ficha ${doc.aprovado ? "ficha-ok" : "ficha-aviso"}`}>
                <span aria-hidden="true" className="ficha__ponto" />
                {doc.aprovado ? "Aprovado" : "Rascunho"}
              </span>
              {doc.aprovado ? "" : "revise antes de usar · "}
              {new Date(doc.criadoEm).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
                // Fuso fixo: o servidor roda em UTC e o navegador no fuso de
                // quem abre; sem isto, a hora do servidor e a do navegador
                // divergem e a hidratação do React falha.
                timeZone: "America/Sao_Paulo",
              })}
            </span>
          </span>

          <button
            onClick={() => void copiar(doc)}
            className="botao-vidro botao-pequeno"
          >
            {copiado === doc.chave ? (
              <>
                <IconeCheck tamanho={16} />
                Copiado
              </>
            ) : (
              <>
                <IconeCopiar tamanho={16} />
                Copiar para o prontuário
              </>
            )}
          </button>

          {/*
           * Um link, e não um `fetch` seguido de download programático: o
           * navegador cuida do nome do arquivo, do progresso e do gerenciador
           * de downloads sozinho, e o `content-disposition` da rota já diz
           * como o arquivo se chama.
           */}
          <a
            href={`/api/sessions/${sessionId}/exportar?formato=pdf&documento=${encodeURIComponent(doc.chave)}`}
            className="botao-vidro botao-pequeno"
          >
            <IconeExportar tamanho={16} />
            Baixar PDF
          </a>
        </div>
      ))}

      {erro !== null && (
        <p role="alert" className="alerta alerta-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
