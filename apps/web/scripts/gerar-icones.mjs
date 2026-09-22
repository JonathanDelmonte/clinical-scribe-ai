/**
 * Gera os PNGs do ícone do aplicativo.
 *
 *     node apps/web/scripts/gerar-icones.mjs
 *
 * ## Por que um gerador e não um arquivo binário solto
 *
 * O ícone é código: a cor vem do mesmo tom de destaque do tema, e as ondas são
 * uma fórmula. Commitar só o PNG deixaria três arquivos binários que ninguém
 * consegue revisar, e cuja regeneração depende de alguém lembrar qual programa
 * de imagem foi usado.
 *
 * ## Por que escrever o PNG à mão
 *
 * `sharp` está desligado de propósito no `pnpm-workspace.yaml` — ele compila
 * binário nativo, e o repositório evita isso. Um PNG sem compressão real é
 * cinquenta linhas de `zlib` e CRC, que é menos do que custaria justificar a
 * dependência.
 *
 * Os PNGs gerados SÃO commitados: o `pnpm install` de quem clona não deve
 * precisar rodar um gerador para que o aplicativo tenha ícone.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const destino = join(aqui, "..", "public", "icones");

/** O `--color-accent` do tema claro, em sRGB. */
const FUNDO = [15, 142, 156];
const TRACO = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(tipo, dados) {
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

function png(largura, altura, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(pixels, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Desenha o ícone: fundo arredondado e cinco barras de onda.
 *
 * `margem` existe para a variante mascarável. O Android recorta o ícone em
 * formatos que variam por fabricante — círculo, gota, trevo — e só garante os
 * 80% centrais. Sem a margem, o desenho aparece cortado em metade dos
 * aparelhos.
 */
function desenhar(tamanho, { margem = 0, raio = 0.22 } = {}) {
  const pixels = Buffer.alloc(tamanho * (tamanho * 4 + 1));
  const util = tamanho * (1 - margem * 2);
  const inicio = (tamanho - util) / 2;
  const r = util * raio;

  // Cinco barras, alturas proporcionais — a forma de uma onda de fala.
  const alturas = [0.34, 0.62, 1.0, 0.62, 0.34];
  const larguraBarra = util * 0.1;
  const vao = util * 0.06;
  const larguraTotal = alturas.length * larguraBarra + (alturas.length - 1) * vao;
  const barraX0 = inicio + (util - larguraTotal) / 2;
  const centroY = tamanho / 2;

  for (let y = 0; y < tamanho; y++) {
    const linha = y * (tamanho * 4 + 1);
    pixels[linha] = 0; // filtro "none"

    for (let x = 0; x < tamanho; x++) {
      const p = linha + 1 + x * 4;

      if (!dentroDoQuadradoArredondado(x, y, inicio, util, r)) continue;

      pixels[p] = FUNDO[0];
      pixels[p + 1] = FUNDO[1];
      pixels[p + 2] = FUNDO[2];
      pixels[p + 3] = 255;

      for (let i = 0; i < alturas.length; i++) {
        const bx = barraX0 + i * (larguraBarra + vao);
        const bh = util * 0.5 * alturas[i];
        if (
          x >= bx &&
          x < bx + larguraBarra &&
          y >= centroY - bh / 2 &&
          y < centroY + bh / 2
        ) {
          pixels[p] = TRACO[0];
          pixels[p + 1] = TRACO[1];
          pixels[p + 2] = TRACO[2];
        }
      }
    }
  }

  return png(tamanho, tamanho, pixels);
}

function dentroDoQuadradoArredondado(x, y, inicio, lado, raio) {
  const fim = inicio + lado;
  if (x < inicio || x >= fim || y < inicio || y >= fim) return false;

  const dx = Math.max(inicio + raio - x, 0, x - (fim - raio));
  const dy = Math.max(inicio + raio - y, 0, y - (fim - raio));
  return dx * dx + dy * dy <= raio * raio;
}

mkdirSync(destino, { recursive: true });

const arquivos = [
  ["icone-192.png", desenhar(192)],
  ["icone-512.png", desenhar(512)],
  // Mascarável: o desenho recuado, para sobreviver ao recorte do Android.
  ["icone-512-mascaravel.png", desenhar(512, { margem: 0.1, raio: 0.5 })],
  // O iOS não arredonda sozinho e não aceita transparência no atalho.
  ["apple-touch-icon.png", desenhar(180, { raio: 0 })],
];

for (const [nome, dados] of arquivos) {
  writeFileSync(join(destino, nome), dados);
  console.log(`  ✓ ${nome}  (${(dados.length / 1024).toFixed(1)} KB)`);
}

console.log("✓ ícones gerados em apps/web/public/icones");
