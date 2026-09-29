/**
 * O nome do plano como a pessoa lê. `free` é o identificador no banco, não uma
 * palavra da tela.
 *
 * Mora aqui, e não em `BarraLateral.tsx`, porque aquele arquivo é
 * `"use client"`: uma página de servidor que importasse a constante de lá
 * receberia uma referência de cliente no lugar do objeto, e todo nome
 * viraria `undefined` sem erro nenhum.
 */
export const NOME_DO_PLANO: Record<string, string> = {
  free: "Plano grátis",
  pro: "Plano Pro",
  clinic: "Plano Clínica",
};
