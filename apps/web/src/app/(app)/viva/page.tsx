import { IconeMandar, IconeMicrofone } from "@/components/Icones";
import { Orbe } from "@/components/Orbe";
import { exigirProfissional } from "@/lib/auth";

export const dynamic = "force-dynamic";

const EXEMPLOS = [
  "O que eu combinei com o João sobre o jantar?",
  "Monte a anamnese da Mariana com as últimas consultas",
  "Quem está sem retorno há mais de 60 dias?",
  "Faça um resumo do meu mês",
];

/**
 * A Viva — o assistente que conversa sobre o histórico, por texto ou voz.
 *
 * A tela existe antes do assistente, e diz isso com todas as letras. O
 * assistente é o RAG da §6.3-A da documentação: busca nas consultas de quem
 * pergunta, responde citando a consulta de origem e nunca inventa. Até ele
 * existir, esta página mostra o que vem e não finge responder — um campo que
 * aceita a pergunta e devolve silêncio ensinaria a desconfiar do resto.
 */
export default async function Viva() {
  await exigirProfissional();

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-col items-center justify-center gap-9 py-6 text-center">
      <div className="surgir mb-4">
        <Orbe tamanho={200} className="sm:hidden" />
        <Orbe tamanho={250} className="hidden sm:block" />
      </div>

      <div className="surgir surgir-2 flex max-w-xl flex-col items-center gap-4">
        <span className="ficha ficha-processando">
          <span aria-hidden="true" className="ficha__ponto" />
          Em breve
        </span>
        <h1 className="titulo-pagina">Viva</h1>
        <p className="text-[17px] leading-relaxed text-grafite">
          Sua assistente vai conhecer todas as suas consultas. Você vai poder perguntar
          por texto ou por voz, e pedir documentos como anamnese e relatórios.
        </p>
        <p className="legenda max-w-md">
          Ela vai responder só com o que foi dito nas suas consultas, e mostrar de onde
          tirou cada informação. Só você enxerga os seus pacientes.
        </p>
      </div>

      <ul
        aria-label="Exemplos do que vai dar para perguntar"
        className="surgir surgir-3 flex max-w-2xl flex-wrap justify-center gap-2"
      >
        {EXEMPLOS.map((e) => (
          <li
            key={e}
            className="vidro-polido rounded-full px-4 py-2 text-[14px] text-grafite"
          >
            “{e}”
          </li>
        ))}
      </ul>

      <div className="surgir surgir-4 flex w-full max-w-[680px] flex-col gap-3">
        <div
          aria-disabled="true"
          className="vidro-polido flex h-[68px] items-center gap-2.5 rounded-full pr-2.5 pl-6 opacity-70"
        >
          <input
            disabled
            aria-label="Mensagem para a Viva (ainda indisponível)"
            placeholder="Pergunte ou peça um documento…"
            className="min-w-0 flex-1 bg-transparent text-[15.5px] outline-none placeholder:text-[#66747f]"
          />
          <button
            type="button"
            disabled
            aria-label="Falar com a Viva (ainda indisponível)"
            className="grid size-12 shrink-0 place-items-center rounded-full border border-tinta/10 bg-white/80 text-tinta"
          >
            <IconeMicrofone />
          </button>
          <button
            type="button"
            disabled
            aria-label="Enviar (ainda indisponível)"
            className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#1d2c37] to-tinta text-perola"
          >
            <IconeMandar />
          </button>
        </div>
        <p className="legenda">
          Enquanto isso, cada frase da nota clínica já aponta o trecho do áudio de onde
          saiu.
        </p>
      </div>
    </div>
  );
}
