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
    <section className="vidro flex flex-col gap-4 rounded-[26px] px-6 py-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="titulo-secao">Sua chave de IA</h2>
        {configurada ? (
          <span className="ficha ficha-ok">
            {atual.provider} · {atual.hint}
          </span>
        ) : (
          <span className="ficha">Usando o modelo do sistema</span>
        )}
      </div>

      <p className="text-[15px] leading-relaxed text-grafite">
        As notas são geradas com <code className="text-tinta">{modeloDoSistema}</code>,
        que é nosso. Você pode ligar a sua própria chave — do Claude, do ChatGPT, do
        Gemini ou de qualquer serviço compatível — e aí o consumo vai para a sua conta,
        com os termos que você contratou.
      </p>

      {!cofreDisponivel && (
        <p role="alert" className="alerta alerta-erro">
          Este servidor não está preparado para guardar chaves com segurança (
          <code>SEGREDO_MESTRE</code> ausente). Sem isso não pedimos a sua chave —
          guardá-la sem cifra seria pior que não ter o recurso.
        </p>
      )}

      {cofreDisponivel && !aberto && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <button onClick={() => setAberto(true)} className="botao-vidro botao-pequeno">
            {configurada ? "Trocar a chave" : "Usar minha própria chave"}
          </button>
          {configurada && (
            <button
              onClick={() => void remover()}
              disabled={salvando}
              className="botao-texto"
            >
              Remover e voltar ao modelo do sistema
            </button>
          )}
        </div>
      )}

      {cofreDisponivel && aberto && (
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="rotulo">Fornecedor</span>
            <select
              value={fornecedor}
              onChange={(e) => {
                setFornecedor(e.target.value);
                setErro(null);
              }}
              className="campo"
            >
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
            {spec !== undefined && (
              <span className="legenda mt-1.5 block">
                Onde conseguir: {spec.ondeConseguir}
              </span>
            )}
          </label>

          <label className="block">
            <span className="rotulo">Chave</span>
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
              className="campo font-mono"
            />
            <span className="legenda mt-1.5 block">
              Guardada cifrada. Depois de salva ela não volta para esta tela — só os
              quatro últimos caracteres.
            </span>
          </label>

          <label className="block">
            <span className="rotulo">Modelo</span>
            <input
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
              placeholder={spec?.exemploModelo ?? ""}
              spellCheck={false}
              className="campo font-mono"
            />
          </label>

          {spec?.aceitaBaseUrl === true && (
            <label className="block">
              <span className="rotulo">Endereço do serviço</span>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.groq.com/openai"
                spellCheck={false}
                className="campo font-mono"
              />
              <span className="legenda mt-1.5 block">
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
          <label className="flex cursor-pointer gap-3 rounded-[18px] border border-white/90 bg-viva-claro/60 px-4 py-3.5 text-[15px] text-tinta">
            <input
              type="checkbox"
              checked={semTreino}
              onChange={(e) => setSemTreino(e.target.checked)}
              className="caixa mt-0.5"
            />
            <span>
              Tenho termos de <strong className="font-semibold">não-treinamento</strong>{" "}
              com este fornecedor.
              <span className="legenda mt-1 block text-grafite">
                Sem isto, a chave só vale para áudio de teste. Transcrição de consulta é
                dado sensível de saúde (LGPD Art. 11) e não pode ir para um serviço que
                treina com ela.
              </span>
            </span>
          </label>

          {erro !== null && (
            <p role="alert" className="alerta alerta-erro">
              {erro}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <button
              onClick={() => void salvar()}
              disabled={salvando || chave.trim() === "" || modelo.trim() === ""}
              className="botao-principal botao-pequeno"
            >
              {salvando ? "Conferindo com o fornecedor…" : "Salvar chave"}
            </button>
            <button
              onClick={() => {
                setChave("");
                setAberto(false);
                setErro(null);
              }}
              className="botao-texto"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
