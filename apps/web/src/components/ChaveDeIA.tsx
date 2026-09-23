"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface FornecedorParaTela {
  id: string;
  nome: string;
  ondeConseguir: string;
  exemploModelo: string;
  aceitaBaseUrl: boolean;
}

interface Props {
  fornecedores: FornecedorParaTela[];
  /** O que já está guardado. A chave em si nunca chega aqui. */
  atual: {
    provider: string | null;
    model: string | null;
    hint: string | null;
    baseUrl: string | null;
    dataPolicy: string | null;
  };
  cofreDisponivel: boolean;
  modeloDoSistema: string;
}

/**
 * A chave de IA do próprio profissional.
 *
 * O sistema tem uma chave e ela funciona. Trazer a própria serve a três casos
 * diferentes: quem quer pagar o próprio consumo, quem já tem contrato de
 * não-treinamento com um fornecedor, e quem não quer depender da nossa escolha
 * de IA. Ver ADR-0003.
 *
 * A chave **nunca volta** do servidor depois de salva. O que a tela mostra são
 * os quatro últimos caracteres, o suficiente para reconhecer qual é.
 */
export function ChaveDeIA({
  fornecedores,
  atual,
  cofreDisponivel,
  modeloDoSistema,
}: Props) {
  const router = useRouter();
  const configurada = atual.hint !== null;

  const [aberto, setAberto] = useState(false);
  const [fornecedor, setFornecedor] = useState(atual.provider ?? "anthropic");
  const [chave, setChave] = useState("");
  const [modelo, setModelo] = useState(atual.model ?? "");
  const [baseUrl, setBaseUrl] = useState(atual.baseUrl ?? "");
  const [semTreino, setSemTreino] = useState(atual.dataPolicy === "contractual");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const spec = fornecedores.find((f) => f.id === fornecedor);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    const res = await fetch("/api/configuracoes/ia", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: fornecedor,
        key: chave,
        model: modelo,
        baseUrl,
        contractual: semTreino,
      }),
    });
    setSalvando(false);

    if (!res.ok) {
      const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
      setErro(corpo?.error ?? "não foi possível salvar");
      return;
    }
    // A chave sai da memória do navegador assim que o servidor confirma.
    setChave("");
    setAberto(false);
    router.refresh();
  }

  async function remover() {
    setSalvando(true);
    await fetch("/api/configuracoes/ia", { method: "DELETE" });
    setSalvando(false);
    setChave("");
    setAberto(false);
    router.refresh();
  }

  return (
    <section className="mt-6 space-y-4 rounded-lg border border-line px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-medium">Sua chave de IA</h2>
        {configurada ? (
          <span className="rounded bg-accent/15 px-2 py-0.5 text-xs text-accent">
            {atual.provider} · {atual.hint}
          </span>
        ) : (
          <span className="text-xs text-muted">usando o modelo do sistema</span>
        )}
      </div>

      <p className="text-sm text-muted">
        As notas são geradas com <code className="text-ink">{modeloDoSistema}</code>,
        que é nosso. Você pode ligar a sua própria chave — do Claude, do ChatGPT, do
        Gemini ou de qualquer serviço compatível — e aí o consumo vai para a sua conta,
        com os termos que você contratou.
      </p>

      {!cofreDisponivel && (
        <p
          role="alert"
          className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500"
        >
          Este servidor não está preparado para guardar chaves com segurança (
          <code>SEGREDO_MESTRE</code> ausente). Sem isso não pedimos a sua chave —
          guardá-la sem cifra seria pior que não ter o recurso.
        </p>
      )}

      {cofreDisponivel && !aberto && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setAberto(true)}
            className="rounded-lg border border-line px-4 py-2 text-sm hover:border-accent hover:text-accent"
          >
            {configurada ? "Trocar a chave" : "Usar minha própria chave"}
          </button>
          {configurada && (
            <button
              onClick={() => void remover()}
              disabled={salvando}
              className="text-xs text-muted underline underline-offset-2 hover:text-ink"
            >
              remover e voltar ao modelo do sistema
            </button>
          )}
        </div>
      )}

      {cofreDisponivel && aberto && (
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs tracking-widest text-muted uppercase">
              Fornecedor
            </span>
            <select
              value={fornecedor}
              onChange={(e) => {
                setFornecedor(e.target.value);
                setErro(null);
              }}
              className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
            >
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
            {spec !== undefined && (
              <span className="mt-1 block text-xs text-muted">
                onde conseguir: {spec.ondeConseguir}
              </span>
            )}
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs tracking-widest text-muted uppercase">
              Chave
            </span>
            <input
              type="password"
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              // Sem preenchimento automático: uma chave de API não é senha de
              // site, e um gerenciador guardando-a aqui a espalharia para
              // lugares que ninguém pretendia.
              autoComplete="off"
              spellCheck={false}
              placeholder={configurada ? `atual: ${atual.hint}` : "cole aqui"}
              className="w-full rounded-lg border border-line bg-transparent px-3 py-2 font-mono text-sm"
            />
            <span className="mt-1 block text-xs text-muted">
              Guardada cifrada. Depois de salva ela não volta para esta tela — só os
              quatro últimos caracteres.
            </span>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs tracking-widest text-muted uppercase">
              Modelo
            </span>
            <input
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
              placeholder={spec?.exemploModelo ?? ""}
              spellCheck={false}
              className="w-full rounded-lg border border-line bg-transparent px-3 py-2 font-mono text-sm"
            />
          </label>

          {spec?.aceitaBaseUrl === true && (
            <label className="block text-sm">
              <span className="mb-1 block text-xs tracking-widest text-muted uppercase">
                Endereço do serviço
              </span>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.groq.com/openai"
                spellCheck={false}
                className="w-full rounded-lg border border-line bg-transparent px-3 py-2 font-mono text-sm"
              />
              <span className="mt-1 block text-xs text-muted">
                Precisa ser https — por http a chave e a consulta iriam em texto puro.
              </span>
            </label>
          )}

          {/*
           * A declaração de não-treinamento.
           *
           * Não é caixinha de formulário, é declaração: não existe como
           * perguntar por API se um fornecedor treina com os prompts. Quem
           * sabe é quem assinou o contrato com ele.
           *
           * E ela não muda a regra: sem marcar, o sistema segue recusando
           * consulta de paciente real. O profissional pode aceitar que os
           * dados DELE treinem um modelo; não pode aceitar isso pelo paciente.
           */}
          <label className="flex cursor-pointer gap-3 rounded-md bg-accent/5 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={semTreino}
              onChange={(e) => setSemTreino(e.target.checked)}
              className="mt-0.5 accent-current"
            />
            <span>
              Tenho termos de <strong>não-treinamento</strong> com este fornecedor.
              <span className="mt-0.5 block text-xs text-muted">
                Sem isto, a chave só vale para áudio de teste. Transcrição de consulta é
                dado sensível de saúde (LGPD Art. 11) e não pode ir para um serviço que
                treina com ela.
              </span>
            </span>
          </label>

          {erro !== null && (
            <p role="alert" className="text-sm text-red-500">
              {erro}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => void salvar()}
              disabled={salvando || chave.trim() === "" || modelo.trim() === ""}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface disabled:opacity-40"
            >
              {salvando ? "conferindo com o fornecedor…" : "Salvar chave"}
            </button>
            <button
              onClick={() => {
                setChave("");
                setAberto(false);
                setErro(null);
              }}
              className="text-sm text-muted hover:text-ink"
            >
              cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
