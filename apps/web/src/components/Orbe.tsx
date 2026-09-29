/**
 * O Orbe — o corpo da Viva.
 *
 * Uma esfera de vidro com luz por dentro, feita só de CSS (ver `.orbe` em
 * `globals.css`): nenhuma imagem para baixar, nenhum script rodando. O modo
 * diz o que a IA está fazendo, e a animação é o único jeito de dizer isso sem
 * mais uma palavra na tela:
 *
 *   repouso   respira devagar, a cada 6,5 s
 *   ouvindo   solta ondas, como quem presta atenção
 *   pensando  a luz de dentro gira mais rápido
 *   falando   pulsa no ritmo da voz
 *   pausado   perde a cor, e quase para
 *
 * Sempre decorativo: quem precisa saber o estado lê a palavra ao lado.
 */

export type ModoDoOrbe = "repouso" | "ouvindo" | "pensando" | "falando" | "pausado";

export function Orbe({
  tamanho,
  modo = "repouso",
  className,
}: {
  tamanho: number;
  modo?: ModoDoOrbe | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      aria-hidden="true"
      data-modo={modo}
      className={className === undefined ? "orbe" : `orbe ${className}`}
      style={{ "--tamanho": `${tamanho}px` } as React.CSSProperties}
    >
      <span className="orbe__anel" />
      <span className="orbe__anel" />
      <span className="orbe__anel" />
      <span className="orbe__brilho" />
      <span className="orbe__esfera">
        <span className="orbe__luz" />
        <span className="orbe__reflexo" />
        <span className="orbe__reflexo orbe__reflexo--baixo" />
      </span>
      <span className="orbe__borda" />
    </div>
  );
}

/** A versão de bolso, para a marca e para os itens de menu da Viva. */
export function PontoViva({ tamanho = 20 }: { tamanho?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full"
      style={{
        width: tamanho,
        height: tamanho,
        background:
          "radial-gradient(circle at 34% 28%, #fff 0%, #c6f0ea 38%, #a5d5f5 66%, #b3a8fa 100%)",
        boxShadow:
          "inset 0 0 0 1px rgb(255 255 255 / 0.9), 0 6px 14px -6px rgb(34 84 110 / 0.45)",
      }}
    />
  );
}
