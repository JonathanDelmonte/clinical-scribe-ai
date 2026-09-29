"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { IconeCheck } from "./Icones";

/**
 * As opções, do mais privado ao mais conservador.
 *
 * A ordem não é acidente: a primeira coisa que a pessoa lê é a alternativa
 * mais protetora. Listar do maior para o menor apresentaria "guardar por
 * muito tempo" como o ponto de partida, e o ponto de partida é o que a maioria
 * mantém.
 */
const OPCOES = [
  { dias: 0, titulo: "Apagar assim que a nota ficar pronta" },
  { dias: 1, titulo: "1 dia" },
  { dias: 7, titulo: "7 dias" },
  { dias: 30, titulo: "30 dias" },
  { dias: 90, titulo: "90 dias" },
  { dias: 365, titulo: "1 ano" },
] as const;

interface Props {
  atual: number | null;
  padraoDoServidor: number;
  /** Quantas consultas perdem o áudio se a escolha for aplicada agora. */
  afetadasPorOpcao: Record<number, number>;
}

/**
 * Por quanto tempo o áudio da consulta fica guardado.
 *
 * A escolha é de quem responde pelo dado, não do servidor. A LGPD (Art. 6º,
 * III) pede tratamento limitado ao necessário, e quem sabe o que é necessário
 * é quem atende: um psicólogo que revisa a nota semanas depois precisa de mais
 * tempo que um pronto-atendimento que aprova no mesmo dia.
 *
 * O que a transcrição e a nota NÃO perdem: elas são texto no banco e
 * sobrevivem. Some o áudio — e com ele a capacidade de clicar numa frase da
 * nota e ouvir o trecho que a sustenta. Essa é a troca real, e ela precisa
 * estar escrita aqui, porque é irreversível e não é óbvia.
 */
export function RetencaoDeAudio({ atual, padraoDoServidor, afetadasPorOpcao }: Props) {
  const router = useRouter();
  const [escolhido, setEscolhido] = useState<number | null>(atual);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const efetivo = escolhido ?? padraoDoServidor;
  const perdem = afetadasPorOpcao[efetivo] ?? 0;
  const mudou = escolhido !== atual;

  async function salvar() {
    setSalvando(true);
    setErro(null);
    const res = await fetch("/api/configuracoes/retencao", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dias: escolhido }),
    });
    setSalvando(false);
    if (!res.ok) {
      const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
      setErro(corpo?.error ?? "não foi possível salvar");
      return;
    }
    setSalvo(true);
    router.refresh();
  }

  return (
    <section className="vidro flex flex-col gap-4 rounded-[26px] px-6 py-6">
      <h2 className="titulo-secao">Por quanto tempo guardar o áudio</h2>

      <p className="text-[15px] leading-relaxed text-grafite">
        A transcrição e a nota ficam para sempre. O que é apagado é a{" "}
        <strong className="font-semibold text-tinta">gravação</strong>, e com ela some a
        possibilidade de clicar numa frase da nota e ouvir o trecho que a sustenta.
      </p>

      <div className="flex flex-col gap-1">
        {OPCOES.map((o) => (
          <label
            key={o.dias}
            className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-[16px] border px-4 py-2.5 text-[15px] transition-colors ${
              efetivo === o.dias
                ? "vidro-polido border-white/95 font-medium"
                : "border-transparent hover:bg-white/60"
            }`}
          >
            <input
              type="radio"
              name="retencao"
              checked={efetivo === o.dias}
              onChange={() => {
                setEscolhido(o.dias);
                setSalvo(false);
              }}
              className="caixa"
            />
            <span className="flex-1">
              {o.titulo}
              {o.dias === padraoDoServidor && atual === null && (
                <span className="ficha ml-2.5 min-h-6 px-2.5 text-[12px]">padrão</span>
              )}
            </span>
            {(afetadasPorOpcao[o.dias] ?? 0) > 0 && (
              <span className="text-[13px] font-semibold text-aviso">
                apaga {afetadasPorOpcao[o.dias]} agora
              </span>
            )}
          </label>
        ))}
      </div>

      {/*
       * O aviso aparece só quando a escolha tem consequência imediata.
       *
       * Um aviso permanente sobre apagar áudio vira decoração e deixa de ser
       * lido. Aqui ele só existe quando há mesmo consulta prestes a perder a
       * gravação — e diz quantas.
       */}
      {mudou && perdem > 0 && (
        <p role="alert" className="alerta alerta-aviso">
          <strong className="font-semibold">
            {perdem} {perdem === 1 ? "consulta perde" : "consultas perdem"} o áudio na
            próxima varredura.
          </strong>{" "}
          A transcrição e a nota continuam. Isso não tem como ser desfeito.
        </p>
      )}

      {erro !== null && (
        <p role="alert" className="alerta alerta-erro">
          {erro}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          onClick={() => void salvar()}
          disabled={salvando || !mudou}
          className="botao-principal botao-pequeno"
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        {salvo && !mudou && (
          <span className="ficha ficha-ok">
            <IconeCheck tamanho={14} />
            Guardado
          </span>
        )}
        {atual !== null && (
          <button
            onClick={() => {
              setEscolhido(null);
              setSalvo(false);
            }}
            className="botao-texto"
          >
            Voltar ao padrão ({padraoDoServidor} dias)
          </button>
        )}
      </div>
    </section>
  );
}
