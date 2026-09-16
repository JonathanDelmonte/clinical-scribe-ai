/**
 * Roda a identificação de papel sobre uma sessão já transcrita.
 *
 *     pnpm --filter @scribe/worker check-roles <id-da-sessao>
 *
 * Existe para testar mudanças na heurística contra transcrições reais sem
 * reprocessar o áudio — que leva minutos e não muda nada no que está sendo
 * testado. Iterar rápido sobre dados verdadeiros é o que separa ajustar a
 * regra de adivinhar a regra.
 */

import { identifyRolesByContent, roleByLabel } from "@scribe/core";
import { createServiceClient, sessions, transcriptSegments } from "@scribe/db";
import { asc, eq } from "drizzle-orm";

import { requireDatabaseUrl } from "./config.js";

const aplicar = process.argv.includes("--aplicar");
const sessionId = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (sessionId === undefined) {
  console.error("uso: pnpm --filter @scribe/worker check-roles <id-da-sessao>");
  process.exit(1);
}

const db = createServiceClient(requireDatabaseUrl());

const rows = await db
  .select()
  .from(transcriptSegments)
  .where(eq(transcriptSegments.sessionId, sessionId))
  .orderBy(asc(transcriptSegments.startMs));

if (rows.length === 0) {
  console.error(`sessão ${sessionId} não tem trechos`);
  process.exit(1);
}

const assignments = identifyRolesByContent(rows);

console.log(`\n  ${rows.length} trechos\n`);
for (const a of assignments) {
  const n = rows.filter((r) => r.speakerLabel === a.speakerLabel).length;
  console.log(
    `  ${a.speakerLabel}  →  ${a.role.padEnd(13)}` +
      `confiança ${Math.round(a.confidence * 100)}%   (${n} trechos)`,
  );
  for (const e of a.evidence) {
    const lado = e.weight > 0 ? "prof" : "pac ";
    console.log(`      [${lado}] ${e.signal}: "${e.excerpt.slice(0, 55)}"`);
  }
  console.log("");
}

if (aplicar) {
  const porRotulo = roleByLabel(assignments);
  for (const [label, role] of Object.entries(porRotulo)) {
    await db
      .update(transcriptSegments)
      .set({ role })
      .where(eq(transcriptSegments.speakerLabel, label));
  }
  await db
    .update(sessions)
    .set({ roleAssignment: assignments })
    .where(eq(sessions.id, sessionId));
  console.log("  ✓ aplicado à sessão");
}

process.exit(0);
