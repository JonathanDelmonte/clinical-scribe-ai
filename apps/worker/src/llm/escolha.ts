/**
 * Qual modelo gera o documento DESTA sessão — ADR-0003.
 *
 * Com chave própria cadastrada, é a do profissional, e só ela. Se ela falhar,
 * o documento falha com o motivo, e a chave da instalação NÃO entra no lugar:
 * "nossa chave como reserva" parece gentileza e é conta surpresa — o
 * profissional cadastrou a dele justamente para não usar a nossa. Sem chave
 * própria, vale a da instalação.
 *
 * A política de dados é conferida aqui, por sessão, contra o piso da
 * instalação (`LLM_DATA_POLICY`). Ser a chave do profissional não muda o que o
 * fornecedor faz com a consulta — e o paciente não é parte dessa escolha.
 */

import { decifrar } from "@scribe/auth";
import { checkDataPolicy, type LlmDataPolicy, type LlmProvider } from "@scribe/core";
import { professionals, type Database } from "@scribe/db";
import { eq } from "drizzle-orm";

import { AnthropicLlmProvider } from "./anthropic.js";
import { GoogleLlmProvider } from "./google.js";
import { OpenAiCompativelLlmProvider } from "./openai.js";

/** O que a tela de configurações guardou — com a chave ainda cifrada. */
export interface ChaveCadastrada {
  readonly fornecedor: string;
  readonly modelo: string;
  readonly cifra: string;
  readonly baseUrl: string | null;
  readonly politica: LlmDataPolicy;
}

export interface ChaveAberta {
  readonly fornecedor: string;
  readonly modelo: string;
  readonly chave: string;
  readonly baseUrl: string | null;
  readonly politica: LlmDataPolicy;
}

/** O modelo da instalação, como a partida o resolveu. */
export interface Instalacao {
  readonly provider: LlmProvider | null;
  readonly blockedReason: string | null;
}

export type Escolha =
  | {
      readonly ok: true;
      readonly provider: LlmProvider;
      readonly daChaveDoProfissional: boolean;
    }
  | { readonly ok: false; readonly motivo: string };

export type EscolherLlm = (professionalId: string) => Promise<Escolha>;

// Mensagens que o profissional LÊ, na tela da sessão — por isso sem jargão de
// servidor. O detalhe técnico fica no log.

const CHAVE_ILEGIVEL =
  "A chave de IA cadastrada em Ajustes não pôde ser aberta pela estação " +
  "de processamento: a chave-mestra dela (SEGREDO_MESTRE) é diferente da do " +
  "site. Nada foi enviado a nenhum fornecedor. Quem administra a instalação " +
  "precisa usar a mesma SEGREDO_MESTRE nos dois lugares.";

const CHAVE_DE_TREINO =
  "Sua chave de IA foi cadastrada como de nível gratuito: o fornecedor pode " +
  "usar o texto da consulta para treinar, e esta instalação só aceita " +
  "fornecedores com termos de não-treinamento. Cadastre em Ajustes " +
  "uma chave com esses termos.";

const SEM_MODELO =
  "Nenhum modelo de IA disponível para gerar o documento. Cadastre sua chave " +
  "em Ajustes, ou peça a quem administra a instalação para " +
  "configurar a dela.";

const INSTALACAO_BLOQUEADA =
  "O modelo de IA desta instalação não atende à política de dados exigida " +
  "aqui (só termos de não-treinamento). Cadastre em Ajustes uma " +
  "chave com esses termos.";

/** Os fornecedores da tela de configurações — mesmos identificadores. */
export function fabricarProvedor(c: ChaveAberta): LlmProvider | null {
  switch (c.fornecedor) {
    case "google":
      return new GoogleLlmProvider(c.chave, c.modelo, c.politica, "google");
    case "openai":
      return new OpenAiCompativelLlmProvider({
        nome: "openai",
        raiz: "https://api.openai.com",
        chave: c.chave,
        modelo: c.modelo,
        politica: c.politica,
      });
    case "compativel": {
      if (c.baseUrl === null || c.baseUrl === "") return null;
      let servico = c.baseUrl;
      try {
        servico = new URL(c.baseUrl).host;
      } catch {
        // fica o endereço como veio; a chamada dirá se ele serve
      }
      return new OpenAiCompativelLlmProvider({
        nome: `compativel:${servico}`,
        raiz: c.baseUrl,
        chave: c.chave,
        modelo: c.modelo,
        politica: c.politica,
      });
    }
    case "anthropic":
      return new AnthropicLlmProvider({
        chave: c.chave,
        modelo: c.modelo,
        politica: c.politica,
      });
    default:
      return null;
  }
}

export function criarEscolhaDeLlm(opcoes: {
  readonly lerChave: (professionalId: string) => Promise<ChaveCadastrada | null>;
  readonly instalacao: Instalacao;
  readonly aceita: LlmDataPolicy;
  readonly abrir?: (cifra: string) => string;
  readonly fabricar?: (chave: ChaveAberta) => LlmProvider | null;
}): EscolherLlm {
  const abrir = opcoes.abrir ?? decifrar;
  const fabricar = opcoes.fabricar ?? fabricarProvedor;

  return async (professionalId) => {
    const cadastrada = await opcoes.lerChave(professionalId);

    if (cadastrada !== null) {
      let chave: string;
      try {
        chave = abrir(cadastrada.cifra);
      } catch {
        return { ok: false, motivo: CHAVE_ILEGIVEL };
      }

      const provider = fabricar({
        fornecedor: cadastrada.fornecedor,
        modelo: cadastrada.modelo,
        chave,
        baseUrl: cadastrada.baseUrl,
        politica: cadastrada.politica,
      });
      if (provider === null) {
        return {
          ok: false,
          motivo:
            `O fornecedor "${cadastrada.fornecedor}" cadastrado em Ajustes ` +
            `não é suportado por esta estação de processamento. Escolha outro, ou ` +
            `atualize a estação.`,
        };
      }

      if (!checkDataPolicy(provider, opcoes.aceita).allowed) {
        return { ok: false, motivo: CHAVE_DE_TREINO };
      }
      return { ok: true, provider, daChaveDoProfissional: true };
    }

    const { provider, blockedReason } = opcoes.instalacao;
    if (provider !== null && blockedReason === null) {
      return { ok: true, provider, daChaveDoProfissional: false };
    }
    return { ok: false, motivo: provider === null ? SEM_MODELO : INSTALACAO_BLOQUEADA };
  };
}

/** A chave de IA do profissional, como a tela de configurações a guardou. */
export function lerChaveDoBanco(
  db: Database,
): (professionalId: string) => Promise<ChaveCadastrada | null> {
  return async (professionalId) => {
    const [linha] = await db
      .select({
        fornecedor: professionals.llmProvider,
        modelo: professionals.llmModel,
        cifra: professionals.llmKeyCipher,
        baseUrl: professionals.llmBaseUrl,
        politica: professionals.llmDataPolicy,
      })
      .from(professionals)
      .where(eq(professionals.id, professionalId))
      .limit(1);

    if (
      linha === undefined ||
      linha.fornecedor === null ||
      linha.modelo === null ||
      linha.cifra === null
    ) {
      return null;
    }
    return {
      fornecedor: linha.fornecedor,
      modelo: linha.modelo,
      cifra: linha.cifra,
      baseUrl: linha.baseUrl,
      // Qualquer coisa que não seja a declaração explícita vale como `training`:
      // na dúvida, o fornecedor treina.
      politica: linha.politica === "contractual" ? "contractual" : "training",
    };
  };
}
