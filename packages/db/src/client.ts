import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export type Database = ReturnType<typeof createServiceClient>;

/**
 * Conexão do WORKER — usa service_role e IGNORA todas as políticas RLS.
 *
 * ⚠️ Nunca importe isto em código que roda no navegador ou que responda a
 * requisição de usuário sem checagem própria de dono. Esta conexão enxerga
 * os dados de todos os profissionais.
 */
export function createServiceClient(connectionString: string) {
  const client = postgres(connectionString, {
    max: 5,
    prepare: false,
  });
  return drizzle(client, { schema });
}

/**
 * Conexão da APLICAÇÃO — sujeita a RLS.
 *
 * Sozinha ela não basta: sem um `auth.uid()` definido, `auth.professional_id()`
 * devolve NULL e toda política nega tudo. Use sempre via `withProfessional`.
 */
export function createAppClient(connectionString: string) {
  const client = postgres(connectionString, {
    max: 10,
    prepare: false,
  });
  return drizzle(client, { schema });
}

/**
 * Executa `fn` dentro de uma transação com a identidade do usuário definida,
 * para que as políticas RLS resolvam corretamente.
 *
 * O terceiro argumento de `set_config` é `is_local = true`: o ajuste vale só
 * até o fim da transação. Isso é o que torna seguro usar pool de conexões —
 * sem ele, a identidade vazaria para a próxima requisição que reaproveitasse
 * a mesma conexão, e um profissional leria os dados de outro.
 *
 *     const pacientes = await withProfessional(db, user.id, (tx) =>
 *       tx.select().from(patients)
 *     );
 */
export async function withProfessional<T>(
  db: Database,
  authUserId: string,
  fn: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('request.jwt.claim.sub', ${authUserId}, true)`,
    );
    return fn(tx);
  });
}
