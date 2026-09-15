import { createAppClient, withProfessional, type Database } from "@scribe/db";

/**
 * Conexão da aplicação, sujeita a RLS.
 *
 * Reaproveitada entre recargas do Next em desenvolvimento. Sem o cache global,
 * cada hot reload abriria um pool novo e o Postgres esgotaria conexões em
 * poucos minutos de trabalho.
 */
const globalForDb = globalThis as unknown as { scribeDb?: Database };

function connectionString(): string {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_URL não definida. Copie .env.example para .env e rode `pnpm db:up`.",
    );
  }
  return url;
}

export const db: Database =
  globalForDb.scribeDb ?? (globalForDb.scribeDb = createAppClient(connectionString()));

export { withProfessional };
