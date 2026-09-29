/**
 * A luz atrás do vidro.
 *
 * Quatro manchas desfocadas e um grão de filme, fixos atrás de todo o
 * conteúdo. O vidro só parece vidro quando há algo atrás dele para refratar —
 * sobre um fundo liso, o mesmo painel é só um retângulo branco.
 *
 * `luz` segue a hora do dia (ver `lib/saudacao.ts`); `foco` é a luz da
 * consulta em andamento, mais concentrada no centro.
 */
export function Atmosfera({
  luz = "manha",
}: {
  luz?: "manha" | "tarde" | "noite" | "foco";
}) {
  return (
    <div aria-hidden="true" className="atmosfera" data-luz={luz}>
      <span className="atmosfera__luz atmosfera__luz--a" />
      <span className="atmosfera__luz atmosfera__luz--b" />
      <span className="atmosfera__luz atmosfera__luz--c" />
      <span className="atmosfera__luz atmosfera__luz--d" />
    </div>
  );
}
