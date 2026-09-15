/**
 * Executa o teste de isolamento multi-tenant e falha o processo se vazar.
 *
 * O SQL faz o trabalho (sql/test-rls.sql); este arquivo só o carrega e traduz
 * uma exceção do Postgres em código de saída diferente de zero, para que o CI
 * quebre o build.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const client = postgres(url, {
  max: 1,
  onnotice: (notice) => console.log(`  ${notice.message}`),
});

try {
  const sql = await readFile(join(here, "..", "sql", "test-rls.sql"), "utf8");
  await client.unsafe(sql);
  console.log("✓ isolamento multi-tenant verificado");
} catch (error) {
  console.error("");
  console.error("✗ VAZAMENTO DE DADOS ENTRE PROFISSIONAIS");
  console.error(error instanceof Error ? error.message : error);
  console.error("");
  console.error("Não faça deploy. Revise packages/db/sql/rls.sql.");
  process.exit(1);
} finally {
  await client.end();
}
