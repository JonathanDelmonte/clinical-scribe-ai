"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  FRACAO_RECONHECIDA,
  palavrasDaFrase,
  resultadoDaFrase,
} from "@/lib/teleprompter";
import { useLeituraDeVoz } from "@/lib/useLeituraDeVoz";

import { Atmosfera } from "./Atmosfera";
import {
  IconeAlerta,
  IconeCheck,
  IconeFechar,
  IconePausa,
  IconeRefazer,
  IconeTocar,
} from "./Icones";

/** Abaixo disto a impressão vocal fica instável. */
const MINIMO_S = 15;

type Fase =
  | { tipo: "preparando" }
  | { tipo: "sem-microfone"; mensagem: string }
  | { tipo: "gravando" }
  | { tipo: "revisando" }
  | { tipo: "enviando" }
  | { tipo: "pronto" }
  | { tipo: "falhou"; mensagem: string };

type Veredito = "ouvida" | "parcial" | "conferindo" | "lida";

interface Gravacao {
  readonly arquivo: File;
  readonly url: string;
  readonly segundos: number;
}

/** A extensão que o motor espera, a partir do formato que o navegador gravou. */
function extensao(tipo: string): string {
  if (tipo.includes("mp4")) return "m4a";
  if (tipo.includes("ogg")) return "ogg";
  return "webm";
}

function tempo(segundos: number): string {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

/**
 * O cadastro da voz em tela cheia: ler, parar, ouvir, decidir.
 *
 * Tela cheia porque, gravando, a pessoa só precisa de duas coisas: o que ler
 * e como parar. Tudo o que o cartão explicava antes (para que serve, o que é
 * guardado) já foi lido; repetir durante a leitura só disputa o olhar com o
 * texto que ela precisa ler em voz alta.
 *
 * E o texto não some ao começar a gravar. Na versão anterior o roteiro ficava
 * no cartão e desaparecia no clique, e a pessoa tinha que ler de memória.
 *
 * Nada é enviado sem a pessoa decidir: parar leva à revisão, onde dá para
 * ouvir, gravar de novo ou usar a gravação.
 */
export function CadastroDeVoz({
  frases,
  aoFechar,
  aoCadastrar,
  aoPular,
}: {
  /** Estável entre renderizações (vem de um `useMemo`). */
  frases: readonly string[];
  aoFechar: () => void;
  /** Cadastro concluído e confirmado pela pessoa. */
  aoCadastrar: () => void;
  /** Na chegada, desistir leva adiante em vez de voltar ao cartão. */
  aoPular?: (() => void) | undefined;
}) {
  const [fase, setFase] = useState<Fase>({ tipo: "preparando" });
  /** O cadastro está na fila há muito tempo: ninguém processando agora. */
  const [esperandoMuito, setEsperandoMuito] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [gravacao, setGravacao] = useState<Gravacao | null>(null);
  const [tocando, setTocando] = useState(false);

  const pararRef = useRef<HTMLButtonElement | null>(null);
  const principalRef = useRef<HTMLButtonElement | null>(null);
  const listaRef = useRef<HTMLDivElement | null>(null);
  const atualRef = useRef<HTMLLIElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const partesRef = useRef<Blob[]>([]);
  const segundosRef = useRef(0);
  const nivelRef = useRef(0);
  /** Cada gravação tem um número; a que foi abandonada não chega à revisão. */
  const sessaoRef = useRef(0);
  const urlRef = useRef<string | null>(null);
  const terminarRef = useRef<() => void>(() => undefined);

  const leitura = useLeituraDeVoz(frases, {
    aoTerminar: () => {
      // Um respiro depois da última frase, para não cortar a última sílaba.
      window.setTimeout(() => terminarRef.current(), 700);
    },
    aoNivel: (nivel) => {
      // Sobe na hora e desce devagar: o halo acompanha a voz sem tremer.
      const suave = Math.max(nivel, nivelRef.current * 0.82);
      nivelRef.current = suave;
      pararRef.current?.style.setProperty("--nivel", suave.toFixed(3));
    },
  });
  const { iniciar, parar: pararLeitura, avancar } = leitura;

  const soltarGravacao = useCallback(() => {
    if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setGravacao(null);
    setTocando(false);
  }, []);

  const desligarMicrofone = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const comecar = useCallback(async () => {
    const sessao = ++sessaoRef.current;
    soltarGravacao();
    setSegundos(0);
    segundosRef.current = 0;
    setFase({ tipo: "preparando" });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      if (sessao === sessaoRef.current) {
        setFase({
          tipo: "sem-microfone",
          mensagem:
            "O navegador não deixou usar o microfone. Libere o acesso no cadeado ao lado do endereço do site e tente de novo.",
        });
      }
      return;
    }

    // A tela fechou (ou recomeçou) enquanto o navegador pedia permissão.
    if (sessao !== sessaoRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setFase({
        tipo: "sem-microfone",
        mensagem:
          "Este navegador não conseguiu gravar. Tente pelo Chrome, Edge ou Safari.",
      });
      return;
    }

    streamRef.current = stream;
    partesRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) partesRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (streamRef.current === stream) streamRef.current = null;
      if (recorderRef.current === recorder) recorderRef.current = null;
      if (sessao !== sessaoRef.current) return;

      const tipo = recorder.mimeType !== "" ? recorder.mimeType : "audio/webm";
      const blob = new Blob(partesRef.current, { type: tipo });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setGravacao({
        arquivo: new File([blob], `voz.${extensao(tipo)}`, { type: tipo }),
        url,
        segundos: segundosRef.current,
      });
      setFase({ tipo: "revisando" });
    };

    recorder.start(1000);
    recorderRef.current = recorder;
    await iniciar(stream);
    if (sessao === sessaoRef.current) setFase({ tipo: "gravando" });
  }, [iniciar, soltarGravacao]);

  const parar = useCallback(() => {
    if (recorderRef.current === null) return;
    pararLeitura();
    recorderRef.current.stop();
  }, [pararLeitura]);

  useEffect(() => {
    terminarRef.current = parar;
  }, [parar]);

  // Abrir a tela já é o pedido para gravar: começa sem um segundo clique.
  useEffect(() => {
    void comecar();
    return () => {
      // Sair invalida a gravação em curso (inclusive a que ainda espera a
      // permissão do microfone) e solta o microfone.
      sessaoRef.current++;
      recorderRef.current?.stop();
      recorderRef.current = null;
      desligarMicrofone();
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    };
    // Uma vez por abertura da tela: `comecar` e `desligarMicrofone` são
    // estáveis, e recomeçar a cada renderização abriria o microfone de novo.
  }, []);

  // O cronômetro só anda gravando.
  useEffect(() => {
    if (fase.tipo !== "gravando") return;
    const id = window.setInterval(() => {
      segundosRef.current += 1;
      setSegundos(segundosRef.current);
    }, 1000);
    return () => window.clearInterval(id);
  }, [fase.tipo]);

  // A página de trás não rola enquanto esta tela está aberta.
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);

  // O foco vai para a ação de cada momento: parar, ou a decisão seguinte.
  useEffect(() => {
    if (fase.tipo === "gravando") pararRef.current?.focus();
    else principalRef.current?.focus();
  }, [fase.tipo]);

  // A frase atual fica no meio da lista.
  useEffect(() => {
    const lista = listaRef.current;
    const atual = atualRef.current;
    if (lista === null || atual === null) return;
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    lista.scrollTo({
      top: atual.offsetTop - lista.clientHeight / 2 + atual.offsetHeight / 2,
      behavior: suave ? "smooth" : "auto",
    });
  }, [leitura.frase, fase.tipo]);

  function cancelar() {
    sessaoRef.current++;
    pararLeitura();
    recorderRef.current?.stop();
    desligarMicrofone();
    aoFechar();
  }

  /**
   * Envia a amostra e acompanha o cadastro até o fim.
   *
   * O site só guarda e enfileira (ADR-0005): quem analisa a voz é o ajudante
   * deste computador, ou a estação da equipe. A tela pergunta pela tarefa a
   * cada segundo e meio; fechar a tela não cancela nada — a voz é cadastrada
   * do mesmo jeito quando alguém processar.
   */
  async function enviar() {
    if (gravacao === null) return;
    setFase({ tipo: "enviando" });
    setEsperandoMuito(false);
    const form = new FormData();
    form.append("file", gravacao.arquivo);

    let tarefa: string;
    try {
      const res = await fetch("/api/voice", { method: "POST", body: form });
      const corpo = (await res.json().catch(() => null)) as {
        tarefa?: unknown;
        error?: string;
      } | null;
      if (!res.ok || typeof corpo?.tarefa !== "string") {
        setFase({
          tipo: "falhou",
          mensagem: corpo?.error ?? "Não foi possível cadastrar a sua voz agora.",
        });
        return;
      }
      tarefa = corpo.tarefa;
    } catch {
      setFase({
        tipo: "falhou",
        mensagem: "Sem conexão com o servidor. Confira a internet e tente de novo.",
      });
      return;
    }

    const minha = sessaoRef.current;
    const inicio = Date.now();
    while (sessaoRef.current === minha) {
      await new Promise((r) => window.setTimeout(r, 1500));
      if (sessaoRef.current !== minha) return;
      const estado = (await fetch(`/api/voice?tarefa=${tarefa}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)) as { estado?: string; mensagem?: string } | null;
      if (estado?.estado === "pronta") {
        setFase({ tipo: "pronto" });
        return;
      }
      if (estado?.estado === "falhou" || estado?.estado === "desconhecida") {
        setFase({
          tipo: "falhou",
          mensagem: estado.mensagem ?? "Não foi possível cadastrar a sua voz agora.",
        });
        return;
      }
      // Na fila há muito tempo: ninguém está processando agora.
      if (estado?.estado === "na_fila" && Date.now() - inicio > 45_000) {
        setEsperandoMuito(true);
      }
    }
  }

  function ouvir() {
    const audio = audioRef.current;
    if (audio === null) return;
    if (audio.paused) void audio.play().catch(() => setTocando(false));
    else audio.pause();
  }

  const gravando = fase.tipo === "gravando" || fase.tipo === "preparando";
  const naRevisao = !gravando;
  const conferencia = leitura.estadoDaConferencia.fase;

  function vereditoDa(frase: number): Veredito | null {
    // Só frase que já passou tem veredito.
    if (frase >= leitura.frase && gravando) return null;
    const { fracao } = resultadoDaFrase(leitura.roteiro, leitura.conferencia, frase);
    if (fracao >= FRACAO_RECONHECIDA) return "ouvida";
    if (conferencia === "indisponivel") return "lida";
    if (leitura.pendentes > 0 || conferencia === "carregando") return "conferindo";
    return "parcial";
  }

  // Na revisão, a frase em que a pessoa parou também ganha marca, se algo dela
  // foi ouvido: parar no meio da quarta frase não apaga o que foi lido dela.
  const alcancada = (i: number) =>
    i < leitura.frase ||
    (naRevisao &&
      i === leitura.frase &&
      palavrasDaFrase(leitura.roteiro, i).some(({ indice }) =>
        leitura.conferencia.ouvidas.has(indice),
      ));
  const vereditos = frases.map((_, i) => (alcancada(i) ? vereditoDa(i) : null));
  const reconhecidas = vereditos.filter((v) => v === "ouvida").length;
  const algumaMarcada = vereditos.includes("parcial");
  const curta = gravacao !== null && gravacao.segundos < MINIMO_S;

  const controlesDaRevisao = (
    <div className="flex flex-col gap-4 pt-2">
      {gravacao !== null && (
        <>
          <audio
            ref={audioRef}
            src={gravacao.url}
            onPlay={() => setTocando(true)}
            onPause={() => setTocando(false)}
            onEnded={() => setTocando(false)}
            className="hidden"
          />
          <button
            type="button"
            onClick={ouvir}
            className="botao-texto self-start text-[15px]"
          >
            {tocando ? <IconePausa tamanho={16} /> : <IconeTocar tamanho={16} />}
            {tocando ? "Pausar" : "Ouvir a gravação"}
          </button>
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!curta && (
          <button
            ref={principalRef}
            type="button"
            onClick={() => void enviar()}
            disabled={fase.tipo === "enviando"}
            className="botao-principal"
          >
            {fase.tipo === "enviando" ? "Analisando a sua voz…" : "Usar esta gravação"}
            <span className="botao-icone" aria-hidden="true">
              <IconeCheck tamanho={18} traco={2.2} />
            </span>
          </button>
        )}
        <button
          ref={curta ? principalRef : undefined}
          type="button"
          onClick={() => void comecar()}
          disabled={fase.tipo === "enviando"}
          className={curta ? "botao-principal" : "botao-vidro"}
        >
          <IconeRefazer tamanho={18} />
          Gravar de novo
        </button>
      </div>
      {fase.tipo === "enviando" && esperandoMuito && (
        <p className="alerta alerta-info text-[14px]" role="status">
          Esperando o ajudante deste computador. Confira se ele está ligado, no ícone ao
          lado do relógio do Windows. Pode fechar esta tela: a gravação fica guardada e
          a sua voz é cadastrada assim que ele processar.
        </p>
      )}
    </div>
  );

  const tela = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cadastro-de-voz-titulo"
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-perola"
    >
      <Atmosfera luz="foco" />

      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-4 pb-8 sm:px-8 sm:pt-6">
        <header className="flex items-center justify-between gap-3">
          <h2
            id="cadastro-de-voz-titulo"
            className="text-[15px] font-semibold text-grafite"
          >
            Cadastro da voz
          </h2>
          {fase.tipo === "gravando" && (
            <span className="ficha ficha-gravando tabular-nums">
              <span aria-hidden="true" className="ficha__ponto" />
              Gravando {tempo(segundos)}
            </span>
          )}
          <button
            type="button"
            onClick={fase.tipo === "pronto" ? aoCadastrar : cancelar}
            aria-label={gravando ? "Cancelar a gravação" : "Fechar"}
            className="botao-redondo"
          >
            <IconeFechar />
          </button>
        </header>

        {fase.tipo === "sem-microfone" ? (
          <Mensagem
            icone="alerta"
            titulo="Sem acesso ao microfone"
            texto={fase.mensagem}
          >
            <button
              ref={principalRef}
              type="button"
              onClick={() => void comecar()}
              className="botao-principal"
            >
              Tentar de novo
            </button>
            <button type="button" onClick={aoPular ?? aoFechar} className="botao-texto">
              {aoPular === undefined ? "Fechar" : "Pular por enquanto"}
            </button>
          </Mensagem>
        ) : fase.tipo === "pronto" ? (
          <Mensagem
            icone="check"
            titulo="Sua voz foi cadastrada."
            texto="A partir da próxima consulta, o sistema reconhece quais falas são suas."
          >
            <button
              ref={principalRef}
              type="button"
              onClick={aoCadastrar}
              className="botao-principal"
            >
              Continuar
            </button>
          </Mensagem>
        ) : fase.tipo === "falhou" ? (
          <Mensagem
            icone="alerta"
            titulo="Não deu para cadastrar agora"
            texto={fase.mensagem}
          >
            <button
              ref={principalRef}
              type="button"
              onClick={() => void enviar()}
              className="botao-principal"
            >
              Tentar de novo
            </button>
            <button
              type="button"
              onClick={() => void comecar()}
              className="botao-vidro"
            >
              <IconeRefazer tamanho={18} />
              Gravar de novo
            </button>
            <button type="button" onClick={aoPular ?? aoFechar} className="botao-texto">
              {aoPular === undefined ? "Fechar" : "Pular por enquanto"}
            </button>
          </Mensagem>
        ) : (
          <>
            {/* ---- a leitura, e depois a revisão dela ---------------- */}
            <div className="flex flex-1 flex-col justify-center gap-6 py-6">
              {naRevisao ? (
                <div className="surgir flex flex-col gap-2">
                  <p className="text-[clamp(1.75rem,1.4rem+1.4vw,2.5rem)] leading-tight tracking-[-0.03em]">
                    {curta ? "Ficou curta." : "Gravação pronta."}
                  </p>
                  <p className="text-[15.5px] leading-relaxed text-grafite">
                    {curta
                      ? `Precisamos de pelo menos ${MINIMO_S} segundos de fala. Grave de novo, lendo as frases até o fim.`
                      : `${gravacao?.segundos ?? 0} segundos${
                          conferencia === "indisponivel"
                            ? "."
                            : ` · ${reconhecidas} de ${frases.length} frases reconhecidas.`
                        } Ouça, se quiser, e escolha.`}
                  </p>
                </div>
              ) : (
                <p className="text-[15px] text-grafite">
                  {leitura.acompanhando
                    ? "Leia em voz alta, no seu ritmo. A frase avança quando você faz uma pausa."
                    : "Leia em voz alta e toque na frase quando terminar."}
                </p>
              )}

              <div
                ref={listaRef}
                className={
                  naRevisao
                    ? "flex flex-col"
                    : "teleprompter h-[min(40vh,460px)] min-h-[240px] sm:h-[min(54vh,460px)]"
                }
              >
                <ol
                  className={`flex flex-col ${naRevisao ? "gap-2.5" : "gap-6 py-[18vh]"}`}
                >
                  {frases.map((_, i) => {
                    const lugar = naRevisao
                      ? "revisao"
                      : i < leitura.frase
                        ? "antes"
                        : i === leitura.frase
                          ? "atual"
                          : "depois";
                    const veredito = vereditos[i] ?? null;
                    const palavras = palavrasDaFrase(leitura.roteiro, i);
                    return (
                      <li
                        key={i}
                        ref={lugar === "atual" ? atualRef : undefined}
                        data-lugar={lugar}
                        className="tp-frase"
                        onClick={lugar === "atual" ? avancar : undefined}
                      >
                        <span
                          className="tp-marca"
                          data-veredito={veredito ?? undefined}
                        >
                          {veredito === "ouvida" ? (
                            <IconeCheck tamanho={14} traco={2.4} />
                          ) : veredito === "parcial" ? (
                            <span
                              aria-hidden="true"
                              className="text-[15px] leading-none font-semibold"
                            >
                              ~
                            </span>
                          ) : veredito === "conferindo" ? (
                            <span aria-hidden="true" className="tp-reticencias">
                              <span />
                              <span />
                              <span />
                            </span>
                          ) : veredito === "lida" ? (
                            <IconeCheck tamanho={14} />
                          ) : null}
                          <span className="sr-only">
                            {veredito === "ouvida"
                              ? "Frase reconhecida."
                              : veredito === "parcial"
                                ? "Algumas palavras não foram reconhecidas."
                                : veredito === "conferindo"
                                  ? "Conferindo."
                                  : ""}
                          </span>
                        </span>
                        <span>
                          {palavras.map(({ palavra, indice }, k) => {
                            const ouvida = leitura.conferencia.ouvidas.has(indice);
                            const perdida =
                              veredito === "parcial" &&
                              !ouvida &&
                              palavra.chave.length >= 3;
                            return (
                              <span key={indice}>
                                <span
                                  className="tp-palavra"
                                  data-lida={
                                    lugar === "atual" && k < leitura.lidas
                                      ? ""
                                      : undefined
                                  }
                                  data-ouvida={ouvida ? "" : undefined}
                                  data-perdida={perdida ? "" : undefined}
                                  style={
                                    { "--atraso": `${k * 45}ms` } as React.CSSProperties
                                  }
                                >
                                  {palavra.texto}
                                </span>{" "}
                              </span>
                            );
                          })}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>

              {/* A frase atual, para quem usa leitor de tela. */}
              <p className="sr-only" aria-live="polite">
                {gravando && leitura.frase < frases.length
                  ? `Frase ${leitura.frase + 1} de ${frases.length}: ${frases[leitura.frase]}`
                  : ""}
              </p>

              {algumaMarcada && (
                <p className="surgir alerta alerta-info">
                  Se uma frase ficou marcada, tudo bem. A conferência roda no seu
                  aparelho e às vezes se confunde; o que vale é a sua voz gravada.
                </p>
              )}
              {gravando && conferencia === "carregando" && (
                <p className="legenda">Preparando a conferência das frases…</p>
              )}
              {conferencia === "indisponivel" && (
                <p className="legenda">
                  A conferência das frases não funcionou neste aparelho. A gravação vale
                  do mesmo jeito.
                </p>
              )}

              {naRevisao && controlesDaRevisao}
            </div>

            {/*
             * Parar fica embaixo, ao alcance do polegar, e preso ao rodapé:
             * num celular pequeno, com o aviso aberto, a tela pode rolar, e o
             * botão de parar não pode ser o que sai de vista.
             */}
            {gravando && (
              <div className="sticky bottom-0 -mx-4 flex flex-col items-center gap-2 bg-gradient-to-t from-perola via-perola/85 to-transparent px-4 pt-6 pb-2 sm:-mx-8">
                <button
                  ref={pararRef}
                  type="button"
                  onClick={parar}
                  disabled={fase.tipo !== "gravando"}
                  aria-label="Parar a gravação"
                  className="botao-parar"
                >
                  <span aria-hidden="true" className="botao-parar__quadrado" />
                </button>
                <span className="text-[14px] font-semibold text-grafite">Parar</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  return createPortal(tela, document.body);
}

/** Uma mensagem de tela inteira: ícone, título, texto e as saídas. */
function Mensagem({
  icone,
  titulo,
  texto,
  children,
}: {
  icone: "check" | "alerta";
  titulo: string;
  texto: string;
  children: React.ReactNode;
}) {
  return (
    <div className="surgir flex flex-1 flex-col items-start justify-center gap-5 py-10">
      <span
        aria-hidden="true"
        className={`grid size-14 place-items-center rounded-full ${
          icone === "check"
            ? "bg-viva-claro text-viva-texto"
            : "bg-pessego-claro text-pessego-texto"
        }`}
      >
        {icone === "check" ? (
          <IconeCheck tamanho={26} traco={2.2} />
        ) : (
          <IconeAlerta tamanho={26} />
        )}
      </span>
      <div className="flex flex-col gap-2">
        <p className="text-[clamp(1.75rem,1.4rem+1.4vw,2.5rem)] leading-tight tracking-[-0.03em]">
          {titulo}
        </p>
        <p className="max-w-xl text-[15.5px] leading-relaxed text-grafite">{texto}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
