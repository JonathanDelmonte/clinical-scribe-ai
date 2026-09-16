/**
 * Escolha do provedor de LLM.
 *
 * Decidida pela chave que existe no ambiente, não por uma variável a mais
 * dizendo qual usar. Duas fontes de verdade para a mesma decisão — "qual
 * fornecedor" e "qual chave" — produzem o erro silencioso clássico: a chave da
 * Anthropic configurada, o seletor apontando para o Google, e uma mensagem de
 * autenticação que não menciona nenhum dos dois.
 */

import { checkDataPolicy, type LlmProvider } from "@scribe/core";

import { config } from "../config.js";
import { GoogleLlmProvider } from "./google.js";

const SEM_CHAVE =
  "Nenhuma chave de LLM configurada. A nota clínica precisa de um modelo.\n\n" +
  "Opção gratuita (desenvolvimento e teste):\n" +
  "  1. Gere uma chave em https://aistudio.google.com/apikey\n" +
  '  2. No .env:  GOOGLE_API_KEY="..."\n' +
  '  3. No .env:  LLM_DATA_POLICY="training"\n\n' +
  "⚠️  O nível gratuito do Google treina com os prompts enviados. Serve para\n" +
  "    áudio simulado; não serve para consulta de paciente real.";

/**
 * Monta o provedor, ou explica o que falta.
 *
 * Devolve `null` em vez de lançar quando não há chave: o worker precisa subir
 * e continuar transcrevendo mesmo sem LLM. Transcrição e nota são capacidades
 * independentes, e derrubar a primeira por falta da segunda transformaria uma
 * funcionalidade ausente numa aplicação fora do ar.
 */
export function createLlmProvider(): LlmProvider | null {
  if (config.GOOGLE_API_KEY === undefined || config.GOOGLE_API_KEY === "") {
    return null;
  }
  return new GoogleLlmProvider(config.GOOGLE_API_KEY, config.LLM_MODEL);
}

export interface LlmStatus {
  readonly provider: LlmProvider | null;
  /** Por que a nota não pode ser gerada. `null` quando pode. */
  readonly blockedReason: string | null;
}

/**
 * O provedor e se ele pode ser usado — conferido UMA vez, na partida.
 *
 * Conferir aqui e não na hora de gerar é deliberado. Uma configuração errada
 * descoberta no meio do job significa uma sessão parada, um usuário esperando,
 * e um erro no log que ninguém lê. Descoberta na partida, ela aparece na
 * primeira linha do console de quem acabou de rodar `pnpm dev`.
 */
export function resolveLlm(): LlmStatus {
  const provider = createLlmProvider();
  if (provider === null) {
    return { provider: null, blockedReason: SEM_CHAVE };
  }

  const politica = checkDataPolicy(provider, config.LLM_DATA_POLICY);
  if (!politica.allowed) {
    return { provider, blockedReason: politica.reason };
  }

  return { provider, blockedReason: null };
}

export { GoogleLlmProvider };
