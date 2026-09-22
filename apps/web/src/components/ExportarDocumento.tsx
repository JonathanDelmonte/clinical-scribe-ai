"use client";

import { useState } from "react";

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
        janela.document.write(
          `<pre style="white-space:pre-wrap;font:14px/1.5 system-ui;padding:24px">${texto.replace(
            /[<>&]/g,
            (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c,
          )}</pre>`,
        );
        janela.document.close();
      }
    } catch {
      setErro("sem conexão com o servidor");
    }
  }

  if (documentos.length === 0) {
    return (
      <p className="text-sm text-muted">
        Esta consulta ainda não tem documentos gerados.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {documentos.map((doc) => (
        <div
          key={doc.chave}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-4 py-3"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{doc.titulo}</span>
            <span className="block text-xs text-muted">
              {doc.aprovado ? "aprovado" : "rascunho — revise antes de usar"} ·{" "}
              {new Date(doc.criadoEm).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </span>
          </span>

          <button
            onClick={() => void copiar(doc)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent"
          >
            {copiado === doc.chave ? "copiado ✓" : "copiar para o prontuário"}
          </button>

          {/*
           * Um link, e não um `fetch` seguido de download programático: o
           * navegador cuida do nome do arquivo, do progresso e do gerenciador
           * de downloads sozinho, e o `content-disposition` da rota já diz
           * como o arquivo se chama.
           */}
          <a
            href={`/api/sessions/${sessionId}/exportar?formato=pdf&documento=${encodeURIComponent(doc.chave)}`}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-surface"
          >
            baixar PDF
          </a>
        </div>
      ))}

      {erro !== null && (
        <p role="alert" className="text-sm text-red-500">
          {erro}
        </p>
      )}
    </div>
  );
}
