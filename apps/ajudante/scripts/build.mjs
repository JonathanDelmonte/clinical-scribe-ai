// Compila o ajudante: processo principal, ponte e janela, cada um num arquivo.
//
// Tudo empacotado pelo esbuild — o executável final não carrega node_modules,
// o que poupa o electron-builder da briga conhecida com o pnpm.

import { existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(raiz, "dist");

await rm(dist, { recursive: true, force: true });

const comum = { bundle: true, logLevel: "warning", legalComments: "none" };
await build({
  ...comum,
  entryPoints: [join(raiz, "src/main/index.ts")],
  outfile: join(dist, "main.cjs"),
  platform: "node",
  format: "cjs",
  target: "node22",
  // `original-fs` é um módulo embutido do Electron, como o próprio `electron`.
  external: ["electron", "original-fs"],
});
await build({
  ...comum,
  entryPoints: [join(raiz, "src/preload.ts")],
  outfile: join(dist, "preload.cjs"),
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
});
await build({
  ...comum,
  entryPoints: [join(raiz, "src/ui/app.ts")],
  outfile: join(dist, "ui/app.js"),
  platform: "browser",
  format: "iife",
  target: "chrome130",
});

for (const arquivo of ["index.html", "estilo.css"]) {
  await copyFile(join(raiz, "src/ui", arquivo), join(dist, "ui", arquivo));
}

// A fonte vem de `recursos.mjs`; sem ela, a janela cai na do sistema.
const fonte = join(raiz, "recursos/fontes/HostGrotesk.ttf");
if (existsSync(fonte)) {
  await mkdir(join(dist, "ui/fontes"), { recursive: true });
  await copyFile(fonte, join(dist, "ui/fontes/HostGrotesk.ttf"));
} else {
  console.error("aviso: sem a fonte Host Grotesk — rode `pnpm recursos`");
}

console.error("ajudante compilado em dist/");
