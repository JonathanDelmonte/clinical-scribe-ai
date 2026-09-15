/**
 * Aplica extensões, migrations e políticas RLS — um comando, qualquer sistema.
 *
 * Existe em vez de um script com `psql` por dois motivos concretos:
 *
 *   1. `psql` não vem instalado no Windows, e o projeto é desenvolvido lá.
 *   2. O `drizzle-kit migrate` falhou neste ambiente com um erro opaco
 *      ("undefined"), enquanto o mesmo SQL aplicado direto funcionou. O
 *      migrator da própria drizzle-orm é mais previsível.
 *
 * Usa o driver `postgres` que o pacote já tem. Zero dependência nova.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("DATABASE_URL não definida — copie .env.example para .env");
  process.exit(1);
}

// `max: 1` porque migration é sequencial por natureza: duas conexões
// aplicando o mesmo lote é como a corrida acontece.
const client = postgres(url, { max: 1, onnotice: () => {} });

try {
  console.log("→ extensões e papéis");
  const extensions = await readFile(
    join(packageRoot, "sql", "00-extensions.sql"),
    "utf8",
  );
  await client.unsafe(extensions);

  console.log("→ migrations");
  await migrate(drizzle(client), {
    migrationsFolder: join(packageRoot, "migrations"),
  });

  console.log("→ políticas RLS");
  const rls = await readFile(join(packageRoot, "sql", "rls.sql"), "utf8");
  await client.unsafe(rls);

  console.log("✓ banco atualizado");
} catch (error) {
  console.error("✗ falha na migração:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end();
}
