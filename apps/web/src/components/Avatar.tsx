import { iniciais, luzDoAvatar } from "@/lib/avatar";

/**
 * Iniciais sobre uma luz própria. Decorativo: o nome sempre aparece ao lado,
 * e o leitor de tela lê o nome, não "M C".
 */
export function Avatar({
  nome,
  chave,
  tamanho = 42,
  className,
}: {
  nome: string;
  /** O que decide a cor — o ID, para a cor não mudar se o nome mudar. */
  chave: string;
  tamanho?: number;
  className?: string | undefined;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-tinta ${className ?? ""}`}
      style={{
        width: tamanho,
        height: tamanho,
        fontSize: Math.round(tamanho * 0.33),
        background: luzDoAvatar(chave),
        boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.9)",
      }}
    >
      {iniciais(nome)}
    </span>
  );
}
