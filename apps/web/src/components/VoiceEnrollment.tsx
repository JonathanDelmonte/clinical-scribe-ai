"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
    <section className="space-y-4 rounded-lg border border-line px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-medium">Sua voz</h2>
        {enrolledAt !== null ? (
          <span className="rounded bg-accent/15 px-2 py-0.5 text-xs text-accent">
            cadastrada
          </span>
        ) : (
          <span className="text-xs text-muted">ainda não cadastrada</span>
        )}
      </div>

      <p className="text-sm text-muted">
        Grave uma amostra da sua voz e o sistema passa a reconhecer quais falas são suas
        em cada consulta. É uma camada <strong>a mais</strong> sobre a separação
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
      <p className="rounded-md bg-accent/5 px-3 py-2 text-xs text-muted">
        A gravação <strong className="text-ink">não é guardada</strong>. O sistema
        extrai dela 256 números que representam o timbre da sua voz, e descarta o áudio.
        Você pode apagar essa impressão quando quiser.
      </p>

      {!gravando && enrolledAt === null && (
        <ol className="space-y-1 text-sm">
          <li className="mb-1 text-xs tracking-widest text-muted uppercase">
            leia em voz alta, sem pressa
          </li>
          {ROTEIRO.map((linha) => (
            <li key={linha} className="text-muted">
              · {linha}
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {gravando ? (
          <>
            <button
              onClick={parar}
              disabled={!suficiente}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 font-medium text-white disabled:opacity-40"
            >
              <span className="size-2.5 animate-pulse rounded-full bg-white" />
              {suficiente ? "Concluir" : `Fale mais ${MINIMO_S - segundos}s`}
            </button>
            <span className="font-mono text-sm tabular-nums text-muted">
              {segundos}s / {SUGERIDO_S}s
            </span>
          </>
        ) : (
          <button
            onClick={() => void iniciar()}
            disabled={status !== null}
            className="rounded-lg bg-accent px-5 py-2.5 font-medium text-surface disabled:opacity-40"
          >
            {enrolledAt === null ? "Gravar minha voz" : "Regravar"}
          </button>
        )}

        {enrolledAt !== null && !gravando && (
          <button
            onClick={async () => {
              await fetch("/api/voice", { method: "DELETE" });
              router.refresh();
            }}
            className="text-xs text-muted underline underline-offset-2 hover:text-ink"
          >
            apagar impressão vocal
          </button>
        )}
      </div>

      {status !== null && <p className="text-sm text-muted">{status}</p>}
      {erro !== null && (
        <p role="alert" className="text-sm text-red-500">
          {erro}
        </p>
      )}
    </section>
  );
}
