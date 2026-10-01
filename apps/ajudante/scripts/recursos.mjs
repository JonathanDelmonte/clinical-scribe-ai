// Junta o que o ajudante leva consigo, em `recursos/` (fora do Git):
//
// - uv          o instalador de Python (Astral, MIT/Apache-2.0), versão fixa e
//               conferida pelo SHA-256 publicado;
// - motor/      o código do motor (o mesmo do Docker) e o script dos modelos;
// - modelos/    a separação de vozes (pyannote 3.1 + segmentation-3.0, MIT):
//               no Hugging Face eles são fechados por formulário, então são
//               baixados aqui, com o HF_TOKEN de quem constrói, e levados
//               junto com a licença;
// - fontes/     Host Grotesk (OFL), a fonte do Respiro;
// - icones/     o ícone do site.
//
// O que já existe não é baixado de novo.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(raiz, "../..");
const destino = join(raiz, "recursos");
const VERSAO_DO_UV = "0.12.21";

async function baixar(url, arquivo, cabecalhos = {}) {
  if (existsSync(arquivo)) return false;
  await mkdir(dirname(arquivo), { recursive: true });
  const res = await fetch(url, { headers: cabecalhos, redirect: "follow" });
  if (!res.ok) throw new Error(`${url} respondeu ${res.status}`);
  await writeFile(arquivo, new Uint8Array(await res.arrayBuffer()));
  console.error(`baixado: ${arquivo.slice(raiz.length + 1)}`);
  return true;
}

// ---- uv ----------------------------------------------------------------------
const uv = join(destino, "uv/uv.exe");
if (!existsSync(uv)) {
  const base = `https://github.com/astral-sh/uv/releases/download/${VERSAO_DO_UV}/uv-x86_64-pc-windows-msvc.zip`;
  const zip = join(destino, "uv/uv.zip");
  await baixar(base, zip);
  const esperado = (await (await fetch(`${base}.sha256`)).text())
    .trim()
    .split(/\s+/)[0];
  const obtido = createHash("sha256")
    .update(await readFile(zip))
    .digest("hex");
  if (esperado !== obtido)
    throw new Error(`uv: SHA-256 não confere (${obtido} ≠ ${esperado})`);
  // O tar do Windows (bsdtar) abre .zip; o do Git, que costuma vir antes no
  // PATH, não abre — e ainda lê "C:" como endereço de servidor remoto.
  const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  execFileSync(tar, ["-xf", zip, "-C", join(destino, "uv")]);
  await rm(zip);
  for (const extra of ["uvx.exe", "uvw.exe"])
    await rm(join(destino, "uv", extra), { force: true });
  console.error(`uv ${VERSAO_DO_UV}: conferido e extraído`);
}

// ---- motor -------------------------------------------------------------------
await mkdir(join(destino, "motor"), { recursive: true });
for (const arquivo of ["app.py", "canais.py", "requirements.txt"]) {
  await copyFile(
    join(repo, "services/asr-local", arquivo),
    join(destino, "motor", arquivo),
  );
}
await copyFile(
  join(raiz, "motor/preparar_modelos.py"),
  join(destino, "motor/preparar_modelos.py"),
);

// ---- separação de vozes --------------------------------------------------------
const pyannote = join(destino, "modelos/pyannote");
const token = process.env.HF_TOKEN;
const precisa = [
  ["pyannote/speaker-diarization-3.1", "config.yaml", join(pyannote, "config.yaml")],
  [
    "pyannote/segmentation-3.0",
    "pytorch_model.bin",
    join(pyannote, "segmentation-3.0/pytorch_model.bin"),
  ],
];
for (const [modelo, arquivo, local] of precisa) {
  if (existsSync(local)) continue;
  if (!token) {
    throw new Error(
      "HF_TOKEN ausente: ele baixa a separação de vozes (fechada no Hugging Face) " +
        "para levar dentro do ajudante. Rode com o .env da raiz.",
    );
  }
  await baixar(`https://huggingface.co/${modelo}/resolve/main/${arquivo}`, local, {
    authorization: `Bearer ${token}`,
  });
}
await writeFile(
  join(pyannote, "LICENCA.txt"),
  [
    "Separação de vozes do Consulta Viva Ajudante",
    "",
    "pyannote/speaker-diarization-3.1 e pyannote/segmentation-3.0",
    "https://huggingface.co/pyannote — pyannote.audio, CNRS",
    "Distribuídos sob a licença MIT, que permite redistribuição com este aviso.",
    "",
    "MIT License — Copyright (c) 2020 CNRS",
    "",
    "Permission is hereby granted, free of charge, to any person obtaining a copy",
    'of this software and associated documentation files (the "Software"), to deal',
    "in the Software without restriction, including without limitation the rights",
    "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
    "copies of the Software, and to permit persons to whom the Software is",
    "furnished to do so, subject to the following conditions:",
    "",
    "The above copyright notice and this permission notice shall be included in all",
    "copies or substantial portions of the Software.",
    "",
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
    "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
    "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
    "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
    "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
    "SOFTWARE.",
    "",
    "A impressão vocal (pyannote/wespeaker-voxceleb-resnet34-LM, CC-BY-4.0, a partir",
    "do WeSpeaker) é baixada do Hugging Face na instalação, não levada aqui.",
    "",
  ].join("\n"),
  "utf8",
);

// ---- fonte e ícone -------------------------------------------------------------
const fontes = "https://raw.githubusercontent.com/google/fonts/main/ofl/hostgrotesk";
await baixar(
  `${fontes}/HostGrotesk%5Bwght%5D.ttf`,
  join(destino, "fontes/HostGrotesk.ttf"),
);
await baixar(`${fontes}/OFL.txt`, join(destino, "fontes/OFL.txt"));
await mkdir(join(destino, "icones"), { recursive: true });
await copyFile(
  join(repo, "apps/web/public/icones/icone-512.png"),
  join(destino, "icones/icone.png"),
);

console.error("recursos prontos em recursos/");
