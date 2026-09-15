/**
 * Transcreve um arquivo de áudio pela linha de comando.
 *
 *     pnpm asr:try caminho/do/audio.wav
 *     pnpm asr:try audio.m4a --engine local --plan free --role developer
 *
 * É a ferramenta do spike do Marco 1: roda um áudio, mostra a transcrição
 * separada por falante e — o que mais importa — o **fator de tempo real**, que
 * diz se o motor local aguenta o plano grátis nesta máquina.
 *
 * Também serve de demonstração viva da escolha de motor: mude `--role` e
 * `--plan` e veja `resolveEngine()` decidindo.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  formatTimestamp,
  isUsableForRoleIdentification,
  resolveEngine,
  speakerCount,
  type Account,
  type Engine,
  type Plan,
  type UserRole,
} from "@scribe/core";

import { getProvider } from "./providers/index.js";

interface Args {
  file: string;
  engine: Engine | null;
  role: UserRole;
  plan: Plan;
  diarize: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const file = positional[0];
  if (file === undefined) {
    console.error("uso: pnpm asr:try <arquivo> [--engine local|cloud]");
    console.error("                        [--role professional|developer]");
    console.error("                        [--plan free|pro|clinic]");
    console.error("                        [--no-diarize]");
    process.exit(1);
  }

  return {
    file,
    engine: (flag("engine") as Engine | undefined) ?? null,
    role: (flag("role") as UserRole | undefined) ?? "developer",
    plan: (flag("plan") as Plan | undefined) ?? "free",
    diarize: !argv.includes("--no-diarize"),
  };
}

const args = parseArgs(process.argv.slice(2));

const account: Account = {
  role: args.role,
  plan: args.plan,
  preferredEngine: null,
};

const decision = resolveEngine(account, args.engine);

console.log("");
console.log(`  cargo ......... ${account.role}`);
console.log(`  plano ......... ${account.plan}`);
console.log(`  motor pedido .. ${args.engine ?? "(nenhum)"}`);
console.log(`  motor usado ... ${decision.engine}  (${decision.reason})`);
if (decision.ignoredChoice !== null) {
  console.log(
    `  ⚠ descartado .. ${decision.ignoredChoice} — só o cargo developer escolhe`,
  );
}
console.log("");

const audio = await readFile(args.file);
const provider = getProvider(decision.engine);

if (!(await provider.healthy())) {
  console.error(`✗ motor ${decision.engine} não está respondendo.`);
  if (decision.engine === "local") {
    console.error("  Suba o serviço com:  pnpm asr:up");
    console.error("  Acompanhe o log com: pnpm asr:logs");
  }
  process.exit(1);
}

console.log(`transcrevendo ${basename(args.file)}…`);
const result = await provider.transcribe({
  audio: new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength),
  filename: basename(args.file),
  diarize: args.diarize,
});

console.log("");
for (const seg of result.segments) {
  const when = formatTimestamp(seg.startMs);
  console.log(`  [${when}] ${seg.speakerLabel.padEnd(11)} ${seg.text}`);
}

const minutes = result.durationMs / 60_000;
const processingMinutes = result.processingMs / 60_000;

console.log("");
console.log("  ─── métricas ───────────────────────────────────");
console.log(`  modelo ................. ${result.model}`);
console.log(`  idioma detectado ....... ${result.language}`);
console.log(`  duração do áudio ....... ${minutes.toFixed(1)} min`);
console.log(`  tempo de processamento . ${processingMinutes.toFixed(1)} min`);
console.log(
  `  fator de tempo real .... ${result.realtimeFactor ?? "?"}x` +
    (result.realtimeFactor !== null && result.realtimeFactor < 1
      ? "  ⚠ mais lento que a consulta"
      : ""),
);
console.log(`  trechos ................ ${result.segments.length}`);
console.log(
  `  falantes ............... ${speakerCount(result)} ` +
    `[${result.speakers.join(", ")}]`,
);
console.log(`  diarização ............. ${result.diarizationApplied ? "sim" : "NÃO"}`);
if (result.diarizationError !== null) {
  console.log(`  motivo ................. ${result.diarizationError}`);
}

// Projeção para uma consulta típica de 30 minutos — é o número que decide se
// o plano grátis fecha nesta máquina.
if (result.realtimeFactor !== null && result.realtimeFactor > 0) {
  const projected = 30 / result.realtimeFactor;
  console.log("");
  console.log(
    `  → uma consulta de 30 min levaria ~${projected.toFixed(0)} min ` +
      `para processar neste hardware`,
  );
}

const usable = isUsableForRoleIdentification(result);
console.log("");
if (usable.usable) {
  console.log("  ✓ pronto para identificação de papel (Marco 3)");
} else {
  console.log(`  ✗ ainda não utilizável: ${usable.reason}`);
}
console.log("");
