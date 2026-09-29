/**
 * O rosto de cada pessoa na tela: iniciais sobre uma luz própria.
 *
 * Nenhuma foto, de propósito. Foto de paciente é dado pessoal a mais para
 * guardar, e o que a lista precisa é só distinguir uma pessoa da outra de
 * relance — as iniciais e uma cor que se repete toda vez fazem isso.
 */

/**
 * Partículas de nome que não viram inicial.
 *
 * "Maria das Graças" é MG, não MD: a inicial que as pessoas reconhecem é a
 * do nome, e não a da preposição.
 */
const PARTICULAS = new Set(["da", "das", "de", "do", "dos", "e", "d'"]);

/** Títulos também não: a Dra. Ana Ribeiro é AR, como qualquer Ana Ribeiro. */
const TITULOS = /^(dra?|prof(a|ª)?|sra?)\.?$/i;

export function iniciais(nome: string): string {
  const partes = nome
    // O que vem entre parênteses é comentário — "(exemplo)", "(mãe da Júlia)" —,
    // não parte do nome.
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .split(/\s+/)
    .filter(
      (p) =>
        /\p{L}/u.test(p) &&
        !PARTICULAS.has(p.toLocaleLowerCase("pt-BR")) &&
        !TITULOS.test(p),
    );

  const primeira = partes[0];
  if (primeira === undefined) return "?";

  const ultima = partes.length > 1 ? partes[partes.length - 1] : undefined;
  const letra = (p: string | undefined) =>
    p === undefined ? "" : (p.match(/\p{L}/u)?.[0] ?? "");

  return (letra(primeira) + letra(ultima)).toLocaleUpperCase("pt-BR");
}

/**
 * As luzes possíveis — pares pastel da mesma família da atmosfera.
 *
 * Todas claras o bastante para as iniciais em Tinta passarem de 7:1.
 */
const LUZES = [
  ["#FFD8C4", "#F7C6D9"],
  ["#CDEFF0", "#C9DBFF"],
  ["#E6E2FF", "#D5F5F0"],
  ["#D9F5E5", "#CDEFF0"],
  ["#FFF0D1", "#FFD8C4"],
  ["#C9DBFF", "#E6E2FF"],
  ["#F7C6D9", "#E6E2FF"],
] as const;

/**
 * A luz de uma pessoa, sempre a mesma.
 *
 * Vem de um hash da chave (o ID, de preferência), e não de sorteio: a mesma
 * paciente com uma cor diferente a cada tela deixaria de ser reconhecida pela
 * cor, que é justamente o que a cor está ali para fazer.
 */
export function luzDoAvatar(chave: string): string {
  let hash = 5381;
  for (let i = 0; i < chave.length; i++) {
    hash = ((hash << 5) + hash + chave.charCodeAt(i)) >>> 0;
  }
  const [de, para] = LUZES[hash % LUZES.length] ?? LUZES[0];
  return `linear-gradient(140deg, ${de}, ${para})`;
}
