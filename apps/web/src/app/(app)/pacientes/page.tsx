import { LinhaViva } from "@/components/LinhaViva";
import { exigirProfissional } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * A pasta vazia, ao lado da lista, enquanto ninguém foi escolhido.
 *
 * No celular esta página não aparece — a lista ocupa a tela toda. Ver
 * `DivisaoDePacientes`.
 */
export default async function Pacientes() {
  await exigirProfissional();

  return (
    <section className="vidro flex min-h-[520px] flex-col items-center justify-center gap-6 rounded-[30px] px-8 py-16 text-center">
      <LinhaViva className="h-16 w-full max-w-md" />
      <div className="flex max-w-sm flex-col gap-2">
        <h2 className="text-[28px] leading-tight font-normal tracking-[-0.03em]">
          Escolha alguém na lista
        </h2>
        <p className="text-[15px] leading-relaxed text-grafite">
          A pasta abre aqui, com a ficha, as consultas e o botão de começar a próxima.
        </p>
      </div>
    </section>
  );
}
