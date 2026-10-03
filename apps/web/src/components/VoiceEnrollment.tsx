"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { roteiroDeVoz } from "@/lib/teleprompter";

import { CadastroDeVoz } from "./CadastroDeVoz";
import { IconeCheck, IconeEscudo, IconeMicrofone } from "./Icones";

/**
 * Cadastro da voz do profissional: o cartão que convida.
 *
 * A leitura acontece em tela cheia (`CadastroDeVoz`). O cartão fica com o
 * mínimo para decidir: o que é, quanto tempo leva e que o áudio não é
 * guardado. O resto mora em "Como funciona", para quem quiser ler.
 *
 * O roteiro vem de `roteiroDeVoz` (`lib/teleprompter.ts`), e não é enfeite: a
 * impressão vocal fica melhor quando a amostra contém os sons que vão
 * aparecer na consulta.
 */
export function VoiceEnrollment({
  enrolledAt,
  aoConcluir,
  aoPular,
  nome,
  especialidade,
  compacto = false,
}: {
  enrolledAt: string | null;
  /**
   * Chamado depois de cadastrar com sucesso.
   *
   * Existe porque o mesmo componente serve a dois contextos com desfechos
   * diferentes: em Ajustes, cadastrar é o fim (a tela recarrega e mostra
   * "cadastrada"). Na chegada, cadastrar é o meio: falta ir para a aplicação.
   * Sem isso, a pessoa gravaria a voz e ficaria parada na mesma tela, sem
   * saber se deu certo nem para onde ir.
   */
  aoConcluir?: () => void;
  /** Na chegada, desistir no meio da gravação leva adiante. */
  aoPular?: (() => void) | undefined;
  /** Para a primeira frase: "Meu nome é Ana Ribeiro e eu trabalho com nutrição." */
  nome?: string | null | undefined;
  especialidade?: string | null | undefined;
  /** Sem título nem explicação: a página em volta já fez esse papel. */
  compacto?: boolean | undefined;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [disponivel, setDisponivel] = useState<boolean | null>(null);
  const [verificacao, setVerificacao] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const frases = useMemo(
    () => roteiroDeVoz({ nome, especialidade }),
    [nome, especialidade],
  );

  /**
   * O serviço que analisa a voz responde?
   *
   * Pergunta antes de oferecer a gravação: descobrir no fim, depois de ler
   * tudo em voz alta, que nada podia ser cadastrado é o pior jeito de
   * descobrir. Enquanto a resposta não vem, o botão continua valendo.
   */
  useEffect(() => {
    let vivo = true;
    fetch("/api/voice", { cache: "no-store" })
      .then((r) =>
        r.ok ? (r.json() as Promise<{ disponivel?: unknown }>) : { disponivel: false },
      )
      .then((d) => {
        if (vivo) setDisponivel(d.disponivel === true);
      })
      .catch(() => {
        if (vivo) setDisponivel(false);
      });
    return () => {
      vivo = false;
    };
  }, [verificacao]);

  function cadastrado() {
    setAberto(false);
    if (aoConcluir !== undefined) aoConcluir();
    else router.refresh();
  }

  async function apagar() {
    setErro(null);
    const res = await fetch("/api/voice", { method: "DELETE" }).catch(() => null);
    if (res === null || !res.ok) {
      setErro("Não foi possível apagar agora. Tente de novo.");
      return;
    }
    router.refresh();
  }

  const cadastrada = enrolledAt !== null;
  const indisponivel = disponivel === false;

  return (
    <section
      className={`vidro flex flex-col items-start gap-5 rounded-[26px] px-6 ${
        compacto ? "py-7" : "py-6"
      }`}
    >
      {!compacto && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="titulo-secao">Sua voz</h2>
            {cadastrada ? (
              <span className="ficha ficha-ok">
                <IconeCheck tamanho={14} />
                Cadastrada
              </span>
            ) : (
              <span className="ficha">Ainda não cadastrada</span>
            )}
          </div>
          <p className="text-[15.5px] leading-relaxed text-grafite">
            {cadastrada
              ? "O sistema já reconhece a sua voz nas consultas. Trocou de microfone ou a voz mudou? Grave de novo."
              : "Leia cinco frases curtas em voz alta e o sistema passa a reconhecer quais falas são suas nas consultas."}
          </p>
        </>
      )}

      {indisponivel && (
        <div className="alerta alerta-info flex flex-col items-start gap-2">
          <p>
            <strong className="font-semibold text-tinta">
              Para cadastrar a voz, ligue o ajudante.
            </strong>{" "}
            É ele que analisa a gravação, aqui no seu computador: o ícone ao lado do
            relógio do Windows. Ainda não tem? Baixe nos ajustes. Você também pode
            seguir sem a voz: a separação de quem falou continua funcionando pelo
            conteúdo da conversa.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <button
              type="button"
              onClick={() => {
                setDisponivel(null);
                setVerificacao((v) => v + 1);
              }}
              className="botao-texto"
            >
              Verificar de novo
            </button>
            <Link href="/configuracoes#ajudante" className="botao-texto">
              O ajudante, nos ajustes
            </Link>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <button
          type="button"
          onClick={() => setAberto(true)}
          disabled={indisponivel}
          className="botao-gravar"
        >
          <span aria-hidden="true" className="botao-gravar__disco">
            <IconeMicrofone tamanho={24} traco={2} />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-[16px] font-semibold">
              {cadastrada ? "Gravar de novo" : "Gravar minha voz"}
            </span>
            <span className="text-[13px] text-nevoa">
              Cinco frases, uns 30 segundos
            </span>
          </span>
        </button>

        {cadastrada && (
          <button type="button" onClick={() => void apagar()} className="botao-texto">
            Apagar impressão vocal
          </button>
        )}
      </div>

      {/*
       * O que é guardado, dito sem rodeio, e à vista.
       *
       * Pedir a voz de alguém sem explicar o que acontece com ela é o tipo de
       * coisa que derruba a confiança num produto de saúde. O áudio não fica
       * salvo: só os 256 números derivados dele, que servem para comparar e
       * não permitem reconstruir a gravação. A frase curta fica sempre
       * visível; o detalhe, a um toque.
       */}
      <p className="flex items-start gap-2 text-[13.5px] leading-relaxed text-grafite">
        <IconeEscudo tamanho={17} className="mt-0.5 shrink-0 text-viva-texto" />
        <span>
          O áudio não fica guardado. Fica só um resumo numérico da sua voz, que você
          apaga quando quiser.
        </span>
      </p>

      <details className="group -mt-2">
        <summary className="botao-texto cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          Como funciona
        </summary>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-grafite">
          É uma camada a mais sobre a separação automática de quem falou: ela corrige
          falas que a separação atribuiu à pessoa errada. Da gravação, o sistema extrai
          256 números que representam o timbre da sua voz e descarta o áudio. Esses
          números servem para comparar trechos da consulta com a sua voz, e não permitem
          reconstruir a gravação.
        </p>
      </details>

      {erro !== null && (
        <p role="alert" className="alerta alerta-erro">
          {erro}
        </p>
      )}

      {aberto && (
        <CadastroDeVoz
          frases={frases}
          aoFechar={() => setAberto(false)}
          aoCadastrar={cadastrado}
          aoPular={aoPular}
        />
      )}
    </section>
  );
}
