import type { Helice as Desenho } from "@/lib/helice";

/**
 * A Hélice da conversa na tela. O desenho sai de `lib/helice.ts`; aqui ficam
 * as cores, as contas e o marcador.
 *
 * O SVG estica para ocupar a caixa (`preserveAspectRatio="none"`) sem engrossar
 * o traço (`non-scaling-stroke`). As contas e o marcador são HTML por cima,
 * posicionados em porcentagem: um círculo dentro do SVG esticado viraria elipse.
 */
export function Helice({
  desenho,
  largura = 1000,
  altura = 100,
  contas = [],
  marcador = null,
  traco = 1.8,
  className,
  rotulo,
}: {
  desenho: Desenho;
  /** O viewBox com que o desenho foi feito. */
  largura?: number;
  altura?: number;
  /** Onde cair cada conta, em porcentagem da largura — as frases citadas. */
  contas?: readonly number[];
  /** O momento em destaque, com o rótulo que aparece em cima dele. */
  marcador?: { posicao: number; rotulo: string } | null;
  traco?: number;
  className?: string | undefined;
  /** Sem rótulo, a hélice é decorativa e some para o leitor de tela. */
  rotulo?: string | undefined;
}) {
  return (
    <div
      className={`relative ${className ?? ""}`}
      {...(rotulo === undefined
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": rotulo })}
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${largura} ${altura}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full overflow-visible"
      >
        <path
          d={`M0 ${altura / 2}H${largura}`}
          stroke="rgb(15 27 36 / 0.14)"
          strokeWidth={1}
          strokeDasharray="2 5"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={desenho.voce}
          fill="none"
          stroke="#1fa39b"
          strokeWidth={traco}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={desenho.paciente}
          fill="none"
          stroke="#eb8a5e"
          strokeWidth={traco}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {contas.map((posicao, i) => (
        <span
          key={`${posicao}-${i}`}
          aria-hidden="true"
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1.5px_var(--color-tinta)]"
          style={{ left: `${posicao}%` }}
        />
      ))}

      {marcador !== null && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-viva-texto transition-[left] duration-500 ease-out"
          style={{ left: `${marcador.posicao}%` }}
        >
          <span className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-full bg-tinta px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-perola tabular-nums">
            {marcador.rotulo}
          </span>
        </span>
      )}
    </div>
  );
}

/** A legenda das duas fitas, para quando a hélice aparece grande. */
export function LegendaDaHelice({ className }: { className?: string | undefined }) {
  return (
    <span
      className={`flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-grafite ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="h-[3px] w-4 rounded-full bg-[#1fa39b]" />
        Você
      </span>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="h-[3px] w-4 rounded-full bg-[#eb8a5e]" />
        Paciente
      </span>
    </span>
  );
}
