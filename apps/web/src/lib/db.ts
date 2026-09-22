import { createAppClient, withProfessional, type Database } from "@scribe/db";

/**
 * Conexão da aplicação, sujeita a RLS.
 *
 * ## Por que a criação é preguiçosa
 *
 * A versão anterior criava o cliente na avaliação do módulo, e com isso
 * `DATABASE_URL` virava requisito de **build**, não de execução. O `next build`
 * avalia os módulos de cada rota para descobrir a configuração dela — e uma
 * esteira de CI que só compila, sem banco nenhum, quebrava com uma mensagem
 * sobre configuração que não tem nada a ver com compilar.
 *
 * É a mesma lição que `lib/auth/config.ts` aprendeu com o `AUTH_SECRET`:
 * configuração de tempo de execução é lida em tempo de execução. A falta dela
 * derruba a primeira requisição que precisa do banco, com a mensagem certa, em
 * vez de derrubar o build com a errada.
 *
 * ## Por que o cache global
 *
 * Reaproveitado entre recargas do Next em desenvolvimento. Sem ele, cada
 * hot reload abriria um pool novo e o Postgres esgotaria conexões em poucos
 * minutos de trabalho.
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

/** A conexão da aplicação. Criada na primeira chamada, reusada depois. */
export function getDb(): Database {
  globalForDb.scribeDb ??= createAppClient(connectionString());
  return globalForDb.scribeDb;
}

export { withProfessional };
