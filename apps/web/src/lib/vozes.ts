/**
 * O nome que uma voz separada pelo diarizador ganha na tela.
 *
 * Mora aqui pelo mesmo motivo que `consent.ts`: é rótulo de exibição, puro, e
 * rótulo de exibição é a coisa mais fácil de se ter em duas versões
 * divergentes. Um lugar só, testável sem montar tela.
 */

/**
 * `SPEAKER_01` → `Voz 2`.
 *
 * O rótulo cru vem do pyannote, que numera as vozes a partir do zero e não faz
 * ideia de quem é quem — é nome de máquina, e na barra "Quem é quem" ele era a
 * única coisa que o profissional via. "SPEAKER_01 = Paciente" obriga a pessoa
 * a decorar um identificador para conferir uma atribuição; "Voz 2 = Paciente"
 * ela lê e entende.
 *
 * Contando de 1 porque o texto é para gente. O rótulo original continua
 * acessível no `title`, que é onde ele serve: diagnóstico.
 *
 * Rótulo sem número volta como veio — um diarizador diferente pode nomear de
 * outro jeito, e `role_assignment` é `jsonb`, então nada garante a forma do
 * que está gravado. Inventar "Voz 1" para o que não tem número seria apagar a
 * única informação verdadeira que a linha carrega.
 */
export function nomeDaVoz(speakerLabel: string): string {
  const numero = /(\d+)\s*$/.exec(speakerLabel)?.[1];
  if (numero === undefined) return speakerLabel;
  return `Voz ${Number(numero) + 1}`;
}
