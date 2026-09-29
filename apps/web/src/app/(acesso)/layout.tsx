import Link from "next/link";

import { Atmosfera } from "@/components/Atmosfera";
import { PontoViva } from "@/components/Orbe";
import { VideoDeFundo } from "@/components/VideoDeFundo";
import { periodoDoDia } from "@/lib/saudacao";

/**
 * Entrar e criar conta: vídeo de fundo, a frase do produto e o cartão de
 * vidro por cima.
 *
 * O vídeo vem de `VIDEO_DE_ENTRADA` (e a imagem de capa, de
 * `VIDEO_DE_ENTRADA_CAPA`), lidos aqui no servidor a cada requisição. Um
 * endereço e não um arquivo no repositório: vídeo pesa megabytes, e o Git
 * guardaria cada versão dele para sempre. Sem a variável, a tela usa a luz da
 * atmosfera — nada quebra enquanto o vídeo não existe.
 *
 * O rodapé com privacidade e termos fica aqui, e não só depois do login: um
 * documento de privacidade que só é alcançável depois de entrar é um
 * documento que a pessoa lê depois de já ter decidido confiar.
 */
export default function LayoutDeAcesso({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const video = process.env["VIDEO_DE_ENTRADA"]?.trim() || undefined;
  const capa = process.env["VIDEO_DE_ENTRADA_CAPA"]?.trim() || undefined;

  return (
    <div className="relative min-h-dvh">
      <Atmosfera luz={periodoDoDia(new Date())} />

      {/*
       * Na mesma camada da atmosfera (`z-index: -1`) e depois dela no
       * documento, para ficar por cima: numa camada mais funda, o fundo
       * opaco da atmosfera cobriria o vídeo inteiro. Sem fundo próprio,
       * enquanto o vídeo carrega (ou se falhar) a atmosfera aparece por trás.
       */}
      {video !== undefined && (
        <div aria-hidden="true" className="fixed inset-0 z-[-1] overflow-hidden">
          <VideoDeFundo src={video} {...(capa === undefined ? {} : { capa })} />
          {/*
           * Um véu claro por cima do vídeo, mais denso onde há texto. Sem ele,
           * a legibilidade da frase dependeria de qual quadro do vídeo está
           * passando — e um vídeo escuro apagaria o texto em Tinta.
           */}
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(242_245_246/0.82)_0%,rgb(242_245_246/0.35)_45%,rgb(242_245_246/0.1)_70%),linear-gradient(0deg,rgb(242_245_246/0.7)_0%,transparent_45%)]" />
        </div>
      )}

      <div className="mx-auto grid min-h-dvh max-w-[1440px] lg:grid-cols-[minmax(0,1fr)_minmax(420px,500px)]">
        <section
          aria-label="Consulta Viva"
          className="flex flex-col justify-between gap-10 px-6 pt-8 pb-4 sm:px-10 lg:px-14 lg:pt-11 lg:pb-14"
        >
          <span className="flex items-center gap-2.5">
            <PontoViva tamanho={28} />
            <span className="text-lg font-semibold tracking-tight">Consulta Viva</span>
          </span>

          <div className="surgir hidden max-w-[820px] flex-col gap-5 lg:flex">
            <h1 className="text-[clamp(3rem,2rem+2.6vw,4.5rem)] leading-[1.02] font-normal tracking-[-0.04em]">
              Olhe para o paciente.
              <br />
              <span className="text-viva-texto">A gente escreve.</span>
            </h1>
            <p className="max-w-md text-[17px] leading-relaxed text-grafite">
              A Consulta Viva ouve a consulta, separa quem falou e entrega a nota pronta
              para você revisar.
            </p>
          </div>
        </section>

        <div className="flex flex-col items-center justify-center gap-6 px-4 pb-10 sm:px-6 lg:py-10 lg:pr-10 lg:pl-0">
          {children}

          <nav aria-label="Documentos" className="flex gap-6 text-[13px]">
            <Link
              href="/privacidade"
              className="text-grafite no-underline hover:text-tinta"
            >
              Privacidade
            </Link>
            <Link href="/termos" className="text-grafite no-underline hover:text-tinta">
              Termos de uso
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}
