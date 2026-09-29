/**
 * "Passo 1 de 2", em palavras e em traços.
 *
 * Os traços dizem o tamanho do caminho num relance; as palavras dizem o mesmo
 * para quem não decifra traços — e para o leitor de tela, que só lê as
 * palavras.
 */
export function Passos({
  atual,
  total = 2,
}: {
  atual: number;
  total?: number | undefined;
}) {
  return (
    <p className="flex items-center gap-3 text-[13px] font-semibold text-grafite">
      <span aria-hidden="true" className="flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full ${
              i < atual ? "w-8 bg-viva-texto" : "w-4 bg-tinta/15"
            }`}
          />
        ))}
      </span>
      Passo {atual} de {total}
    </p>
  );
}
