/**
 * Regras puras — sem banco — que o ajudante também usa, pela entrada
 * `@scribe/processamento/puro`.
 */

/**
 * O que guardar, quando o arquivo da sessão precisa trocar.
 *
 * `audio` é o que o motor vai transcrever — sempre o melhor que existe: o
 * áudio inteiro, sem perdas quando possível. O que fica GUARDADO pode ser
 * outra coisa:
 *
 *   1. Em pedaços (manifesto): os pedaços são juntados por quem processa.
 *   2. Sem mapa de regiões: o arquivo chegou como veio — AMR de gravador
 *      antigo, WMA, ALAC do iPhone — e a tela não conseguiria tocá-lo, e
 *      cada citação da nota depende de ouvir o trecho que a sustenta.
 *   3. O WAV que o navegador preparou, já guardado: nada a fazer (`null`).
 *
 * Nos casos 1 e 2 o arquivo guardado é trocado: o próprio áudio se ele é o
 * WAV do navegador e cabe num arquivo; senão, a cópia comprimida (M4A,
 * ~14 MB por hora), que qualquer navegador toca e que cabe nos 50 MB por
 * arquivo do Supabase gratuito mesmo com horas de consulta.
 */
export interface Guarda {
  readonly wavDoNavegador: boolean;
  readonly limiteBytes: number;
  readonly chaveWav: string;
  readonly chaveM4a: string;
  /**
   * Em pedaços, guardar é obrigatório: sem motor para comprimir não há
   * arquivo final, e a fila tenta de novo. Fora disso, transcreve-se o
   * original mesmo assim.
   */
  readonly obrigatoria: boolean;
}

/** WAV do navegador que cabe num arquivo fica como está; o resto vira M4A. */
export function formatoParaGuardar(
  guarda: Pick<Guarda, "wavDoNavegador" | "limiteBytes">,
  tamanhoBytes: number,
): "wav" | "m4a" {
  return guarda.wavDoNavegador && tamanhoBytes <= guarda.limiteBytes ? "wav" : "m4a";
}
