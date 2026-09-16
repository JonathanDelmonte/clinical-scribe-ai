/**
 * `pnpm llm:models` — lista os modelos que a sua chave realmente acessa.
 *
 * Existe porque nome de modelo é a configuração que mais envelhece: catálogos
 * mudam, modelos são aposentados, e o nome que estava certo num tutorial de
 * três meses atrás devolve 404 hoje. Perguntar ao fornecedor leva um segundo e
 * substitui uma tarde de tentativa e erro.
 */

import { config } from "../config.js";

interface ModeloRemoto {
  name?: string;
  displayName?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

const chave = config.GOOGLE_API_KEY;
if (chave === undefined || chave === "") {
  console.error(
    "GOOGLE_API_KEY não definida.\n" +
      "Gere uma chave gratuita em https://aistudio.google.com/apikey e coloque no .env.",
  );
  process.exit(1);
}

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models?key=${chave}&pageSize=200`,
);

if (!res.ok) {
  const corpo = await res.text();
  console.error(`Google respondeu ${res.status}:\n${corpo}`);
  process.exit(1);
}

const { models = [] } = (await res.json()) as { models?: ModeloRemoto[] };

// Só os que geram texto. A lista inclui modelos de embedding e de contagem de
// tokens, que não servem para a nota e só atrapalham a escolha.
const uteis = models.filter((m) =>
  m.supportedGenerationMethods?.includes("generateContent"),
);

console.log(`\n${uteis.length} modelos disponíveis para esta chave:\n`);

for (const m of uteis) {
  const id = m.name?.replace(/^models\//, "") ?? "?";
  const atual = id === config.LLM_MODEL ? "  ← LLM_MODEL atual" : "";
  const entrada = m.inputTokenLimit?.toLocaleString("pt-BR") ?? "?";
  console.log(`  ${id.padEnd(42)} entrada: ${entrada.padStart(11)} tokens${atual}`);
}

console.log(
  "\nPara a nota clínica, prefira um modelo `flash`: a cota gratuita é bem\n" +
    "maior e a tarefa é extrair o que foi dito, não raciocinar sobre o caso.\n" +
    "Troque em LLM_MODEL no .env.\n",
);
