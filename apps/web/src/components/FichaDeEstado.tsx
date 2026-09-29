import { CLASSE_DO_TOM, estadoDaConsulta } from "@/lib/estados";

import { IconeCheck } from "./Icones";

/** O estado de uma consulta, em palavras, com a cor só acompanhando. */
export function FichaDeEstado({
  status,
  className,
}: {
  status: string;
  className?: string | undefined;
}) {
  const estado = estadoDaConsulta(status);
  return (
    <span className={`ficha ${CLASSE_DO_TOM[estado.tom]} ${className ?? ""}`}>
      {estado.tom === "ok" ? (
        <IconeCheck tamanho={14} traco={2.4} />
      ) : (
        <span aria-hidden="true" className="ficha__ponto" />
      )}
      {estado.rotulo}
    </span>
  );
}
