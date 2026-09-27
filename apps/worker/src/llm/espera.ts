/** Esperar entre tentativas — substituível nos testes, que não podem dormir. */
export type Dormir = (ms: number) => Promise<void>;

export const dormirPadrao: Dormir = (ms) =>
  new Promise((pronto) => setTimeout(pronto, ms));

/** Mais que isto e o job fica parado sem ninguém saber por quê. */
const ESPERA_MAXIMA_MS = 120_000;

/**
 * Quanto o fornecedor pediu para esperar, quando pediu: `retry-after-ms`
 * (OpenAI), ou `retry-after` em segundos ou como data — o padrão do HTTP.
 */
export function esperaSugerida(res: Response): number | null {
  const ms = Number(res.headers.get("retry-after-ms") ?? "");
  if (Number.isFinite(ms) && ms > 0) return Math.min(ms, ESPERA_MAXIMA_MS);

  const valor = res.headers.get("retry-after");
  if (valor === null || valor.trim() === "") return null;
  const segundos = Number(valor);
  if (Number.isFinite(segundos) && segundos >= 0) {
    return Math.min(segundos * 1000, ESPERA_MAXIMA_MS);
  }
  const data = Date.parse(valor);
  return Number.isNaN(data)
    ? null
    : Math.min(Math.max(0, data - Date.now()), ESPERA_MAXIMA_MS);
}
