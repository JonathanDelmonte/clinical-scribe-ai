import { describe, expect, it } from "vitest";

import { nomeDaVoz } from "./vozes";

describe("nome legível da voz", () => {
  /**
   * O pyannote numera a partir de zero; gente conta a partir de um. O
   * deslocamento é a única coisa que esta função faz, e é a que transforma um
   * identificador de máquina em algo que dá para relacionar com a transcrição
   * logo abaixo.
   */
  it.each([
    ["SPEAKER_00", "Voz 1"],
    ["SPEAKER_01", "Voz 2"],
    ["SPEAKER_02", "Voz 3"],
    ["SPEAKER_10", "Voz 11"],
  ])("%s → %s", (rotulo, esperado) => {
    expect(nomeDaVoz(rotulo)).toBe(esperado);
  });

  /**
   * Rótulo sem número volta como veio.
   *
   * Um diarizador diferente pode nomear de outro jeito, e o `role_assignment`
   * é `jsonb` — nada garante a forma do que está gravado. Inventar "Voz 1"
   * para o que não tem número seria apagar a única informação verdadeira que
   * a linha carrega.
   */
  it.each(["SPEAKER", "convidado", "", "voz-A"])("%o volta inalterado", (rotulo) => {
    expect(nomeDaVoz(rotulo)).toBe(rotulo);
  });
});
