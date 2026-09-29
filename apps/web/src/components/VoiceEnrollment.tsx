"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { IconeCheck, IconeEscudo, IconeMicrofone } from "./Icones";

/** Abaixo disto a impressão vocal fica instável. */
const MINIMO_S = 15;
/** Acima disto não melhora o bastante para justificar a espera. */
const SUGERIDO_S = 30;

const ROTEIRO = [
  "Meu nome é [seu nome], sou [sua profissão].",
  "Esta é uma amostra da minha voz para o sistema me reconhecer nas consultas.",
  "Bom dia, boa tarde, boa noite. Fique à vontade.",
  "Há quanto tempo você sente isso? Vou pedir alguns exames.",
  "Quero rever você em duas semanas.",
];

/**
 * Cadastro da voz do profissional.
 *
 * O roteiro não é enfeite: a impressão vocal fica melhor quando a amostra
 * contém os sons que vão aparecer na consulta. Ler frases de consulta gera uma
 * referência mais próxima do uso real do que ler qualquer texto.
 */
export function VoiceEnrollment({
  enrolledAt,
  aoConcluir,
}: {
  enrolledAt: string | null;
  /**
   * Chamado depois de cadastrar com sucesso.
   *
   * Existe porque o mesmo componente serve a dois contextos com desfechos
   * diferentes: em configurações, cadastrar é o fim — a tela recarrega e
   * mostra "cadastrada". Na chegada, cadastrar é o meio — falta ir para a
   * aplicação. Sem isso, a pessoa gravaria a voz e ficaria parada na mesma
   * tela, sem saber se deu certo nem para onde ir.
   */
  aoConcluir?: () => void;
}) {
  const router = useRouter();
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  useEffect(() => {
    if (!gravando) return;
    const id = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [gravando]);

  async function enviar(file: File) {
    setStatus("processando a amostra…");
    setErro(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/voice", { method: "POST", body: form });
    setStatus(null);
    if (!res.ok) {
      const corpo = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setErro(corpo?.error ?? "não foi possível cadastrar");
      return;
    }
    if (aoConcluir !== undefined) aoConcluir();
    else router.refresh();
  }

  async function iniciar() {
    setErro(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        void enviar(new File([blob], "voz.webm", { type: blob.type }));
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setSegundos(0);
      setGravando(true);
    } catch {
      setErro("não foi possível acessar o microfone");
    }
  }

  function parar() {
    setGravando(false);
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  const suficiente = segundos >= MINIMO_S;

  return (
    <section className="vidro flex flex-col gap-4 rounded-[26px] px-6 py-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="titulo-secao">Sua voz</h2>
        {enrolledAt !== null ? (
          <span className="ficha ficha-ok">
            <IconeCheck tamanho={14} />
            Cadastrada
          </span>
        ) : (
          <span className="ficha">Ainda não cadastrada</span>
        )}
      </div>

      <p className="text-[15px] leading-relaxed text-grafite">
        Grave uma amostra da sua voz e o sistema passa a reconhecer quais falas são suas
        em cada consulta. É uma camada{" "}
        <strong className="font-semibold text-tinta">a mais</strong> sobre a separação
        automática — ela corrige falas que a separação atribuiu à pessoa errada.
      </p>

      {/*
       * O que é guardado, dito sem rodeio.
       *
       * Pedir a voz de alguém sem explicar o que acontece com ela é o tipo de
       * coisa que derruba a confiança num produto de saúde. O áudio não fica
       * salvo: só os 256 números derivados dele, que servem para comparar e
       * não permitem reconstruir a gravação.
       */}
      <p className="alerta alerta-info flex gap-2.5">
        <IconeEscudo tamanho={18} className="mt-0.5 shrink-0 text-viva-texto" />
        <span>
          A gravação{" "}
          <strong className="font-semibold text-tinta">não é guardada</strong>. O
          sistema extrai dela 256 números que representam o timbre da sua voz, e
          descarta o áudio. Você pode apagar essa impressão quando quiser.
        </span>
      </p>

      {!gravando && enrolledAt === null && (
        <ol className="flex flex-col gap-1.5 rounded-[20px] border border-white/85 bg-white/50 px-5 py-4 text-[15px]">
          <li className="rotulo">Leia em voz alta, sem pressa</li>
          {ROTEIRO.map((linha) => (
            <li key={linha} className="leading-relaxed text-tinta">
              {linha}
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {gravando ? (
          <>
            <button onClick={parar} disabled={!suficiente} className="botao-principal">
              <span
                aria-hidden="true"
                className="size-2.5 animate-pulse rounded-full bg-gravando-ponto"
              />
              {suficiente ? "Concluir" : `Fale mais ${MINIMO_S - segundos}s`}
            </button>
            <span className="text-[15px] font-medium tabular-nums text-grafite">
              {segundos}s de {SUGERIDO_S}s
            </span>
          </>
        ) : (
          <button
            onClick={() => void iniciar()}
            disabled={status !== null}
            className={enrolledAt === null ? "botao-principal" : "botao-vidro"}
          >
            {enrolledAt === null ? "Gravar minha voz" : "Regravar"}
            <span className="botao-icone" aria-hidden="true">
              <IconeMicrofone tamanho={18} />
            </span>
          </button>
        )}

        {enrolledAt !== null && !gravando && (
          <button
            onClick={async () => {
              await fetch("/api/voice", { method: "DELETE" });
              router.refresh();
            }}
            className="botao-texto"
          >
            Apagar impressão vocal
          </button>
        )}
      </div>

      {status !== null && (
        <p className="ficha ficha-processando self-start">
          <span aria-hidden="true" className="ficha__ponto" />
          {status}
        </p>
      )}
      {erro !== null && (
        <p role="alert" className="alerta alerta-erro">
          {erro}
        </p>
      )}
    </section>
  );
}
