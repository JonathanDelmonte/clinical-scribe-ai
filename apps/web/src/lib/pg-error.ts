/**
 * O código SQLSTATE de um erro do Postgres, atravessando o encadeamento de
 * causas.
 *
 * Existe porque o erro que chega ao `catch` quase nunca é o erro do banco. O
 * driver lança o `PostgresError`, o Drizzle o embrulha ao desfazer a
 * transação, e o que sobra na mão é um `Error` genérico com o original em
 * `cause` — às vezes dois níveis abaixo.
 *
 * O sintoma de não fazer isto é específico e enganoso: o `catch` existe, o
 * `if (error.code === "23505")` está escrito, e mesmo assim o cadastro com
 * e-mail repetido responde 500. Parece que o tratamento não foi escrito;
 * na verdade ele está olhando para o embrulho.
 */
export function codigoPostgres(error: unknown, profundidadeMaxima = 5): string | null {
  let atual: unknown = error;

  for (let i = 0; i < profundidadeMaxima; i++) {
    if (typeof atual !== "object" || atual === null) return null;

    const { code, cause } = atual as { code?: unknown; cause?: unknown };
    // SQLSTATE tem exatamente cinco caracteres. A conferência evita confundir
    // com o `code` de um erro de sistema — `ENOTFOUND`, `ECONNREFUSED` — que
    // também viaja em `cause` quando o banco está fora do ar.
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;

    atual = cause;
  }

  return null;
}

/** Violação de índice único. */
export const UNIQUE_VIOLATION = "23505";
