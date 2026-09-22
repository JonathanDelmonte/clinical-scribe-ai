/**
 * O plano de envio de um áudio em pedaços — a aritmética, sem rede.
 *
 * Separado do envio de propósito: é a parte que decide **o que** sobe e **o
 * que falta**, e é a parte em que um erro de um byte produz um áudio remontado
 * com um buraco no meio, sem nenhum erro aparecer em lugar nenhum.
 */

export interface Parte {
  readonly indice: number;
  /** Deslocamento inicial, inclusivo. */
  readonly inicio: number;
  /** Deslocamento final, exclusivo — pronto para `Blob.slice`. */
  readonly fim: number;
}

/**
 * 512 KB.
 *
 * Grande o bastante para que uma consulta de 30 minutos caiba em menos de dez
 * pedaços, e pequeno o bastante para que perder um numa rede de celular custe
 * meio segundo de reenvio em vez de recomeçar o arquivo inteiro.
 */
export const TAMANHO_DA_PARTE = 512 * 1024;

export function planejarPartes(
  tamanhoTotal: number,
  tamanhoDaParte: number = TAMANHO_DA_PARTE,
): Parte[] {
  if (tamanhoTotal <= 0 || tamanhoDaParte <= 0) return [];

  const partes: Parte[] = [];
  for (let inicio = 0, indice = 0; inicio < tamanhoTotal; inicio += tamanhoDaParte) {
    partes.push({
      indice: indice++,
      inicio,
      fim: Math.min(inicio + tamanhoDaParte, tamanhoTotal),
    });
  }
  return partes;
}

/**
 * As partes que ainda precisam subir.
 *
 * É o que transforma "a rede caiu" em "continua de onde parou": o servidor diz
 * quais índices já tem, e o que sobra desta conta é o trabalho restante.
 */
export function partesFaltando(
  planejadas: readonly Parte[],
  recebidas: readonly number[],
): Parte[] {
  const jaTem = new Set(recebidas);
  return planejadas.filter((p) => !jaTem.has(p.indice));
}

/**
 * Espera antes da tentativa `n` (base zero), em milissegundos.
 *
 * Crescimento exponencial com um pouco de aleatoriedade. A aleatoriedade não é
 * enfeite: sem ela, se a rede voltar depois de uma queda, todos os pedaços
 * pendentes tentam de novo no mesmo instante e derrubam a conexão de novo — o
 * rebanho trovejante, em miniatura.
 */
export function esperaDeTentativa(
  tentativa: number,
  aleatorio: () => number = Math.random,
): number {
  const base = Math.min(1000 * 2 ** tentativa, 8000);
  return Math.round(base * (0.75 + aleatorio() * 0.5));
}
