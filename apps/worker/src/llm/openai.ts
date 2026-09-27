/**
 * Qualquer API no formato da OpenAI — a própria OpenAI e o que adotou o
 * formato dela: Groq, Together, OpenRouter, DeepSeek, vLLM auto-hospedado.
 * Um adaptador, dezenas de serviços (ADR-0003).
 *
 * `raiz` é o endereço SEM o `/v1`: o mesmo que a tela de configurações
 * confere em `<raiz>/v1/models` antes de guardar a chave. Guardado desse
 * jeito, o endereço que passou na conferência é o endereço que funciona aqui.
 */

import type {
  FormatoDaResposta,
  LlmCompletion,
  LlmDataPolicy,
  LlmProvider,
} from "@scribe/core";

import { dormirPadrao, esperaSugerida, type Dormir } from "./espera.js";

const MAX_TENTATIVAS = 4;
const ESPERA_PADRAO_MS = 10_000;

interface RespostaChat {
  model?: string;
  choices?: {
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpcoesOpenAi {
  readonly nome: string;
  readonly raiz: string;
  readonly chave: string;
  readonly modelo: string;
  readonly politica: LlmDataPolicy;
  readonly fetchImpl?: typeof fetch;
  readonly dormir?: Dormir;
}

/**
 * Campos do pedido que um serviço pode recusar sem que o resto deixe de valer.
 *
 * Modelos de raciocínio da OpenAI recusam `temperature` diferente do padrão;
 * servidores compatíveis mais simples não conhecem `json_schema`. Recusado
 * pelo nome, o campo sai e o pedido segue — perder a temperatura zero ou o
 * esquema é melhor que não ter nota. O prompt continua pedindo JSON, e a
 * leitura da resposta tolera o que vier embrulhado.
 */
function campoRecusado(
  mensagem: string,
  corpo: Record<string, unknown>,
): string | null {
  const m = mensagem.toLowerCase();
  if ("temperature" in corpo && m.includes("temperature")) return "temperature";
  if (
    "response_format" in corpo &&
    (m.includes("response_format") || m.includes("json_schema") || m.includes("schema"))
  ) {
    return "response_format";
  }
  return null;
}

export class OpenAiCompativelLlmProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly dataPolicy: LlmDataPolicy;
  private readonly raiz: string;
  private readonly chave: string;
  private readonly fetchImpl: typeof fetch;
  private readonly dormir: Dormir;

  constructor(opcoes: OpcoesOpenAi) {
    this.name = opcoes.nome;
    this.model = opcoes.modelo;
    this.dataPolicy = opcoes.politica;
    this.raiz = opcoes.raiz.replace(/\/+$/, "");
    this.chave = opcoes.chave;
    this.fetchImpl = opcoes.fetchImpl ?? fetch;
    this.dormir = opcoes.dormir ?? dormirPadrao;
  }

  private get cabecalhos(): Record<string, string> {
    return {
      authorization: `Bearer ${this.chave}`,
      "content-type": "application/json",
    };
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.raiz}/v1/models`, {
        headers: this.cabecalhos,
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(prompt: string, formato?: FormatoDaResposta): Promise<LlmCompletion> {
    const corpo: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      // Zero pelo mesmo motivo do Google: a mesma consulta deve dar a mesma nota.
      temperature: 0,
      ...(formato === undefined
        ? {}
        : {
            response_format: {
              type: "json_schema",
              json_schema: { name: formato.nome, schema: formato.esquema },
            },
          }),
    };

    let ultimoErro = "";
    let ajustes = 0;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      const res = await this.fetchImpl(`${this.raiz}/v1/chat/completions`, {
        method: "POST",
        headers: this.cabecalhos,
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(180_000),
      });

      if (res.ok) return this.lerResposta((await res.json()) as RespostaChat);

      const texto = await res.text().catch(() => "");
      ultimoErro = mensagemDoErro(texto) ?? `HTTP ${res.status}`;

      if (res.status === 400 && ajustes < 2) {
        const campo = campoRecusado(ultimoErro, corpo);
        if (campo !== null) {
          delete corpo[campo];
          ajustes++;
          tentativa--; // ajuste não é nova tentativa: o problema era o pedido
          continue;
        }
      }

      // 429 é ritmo, 5xx é o serviço; os dois passam. O resto não passa.
      const vaiPassar = res.status === 429 || res.status >= 500;
      if (!vaiPassar || tentativa === MAX_TENTATIVAS) {
        throw new Error(this.explicar(res.status, ultimoErro));
      }
      await this.dormir(esperaSugerida(res) ?? ESPERA_PADRAO_MS * tentativa);
    }

    throw new Error(ultimoErro);
  }

  private lerResposta(dados: RespostaChat): LlmCompletion {
    const escolha = dados.choices?.[0];
    const recusa = escolha?.message?.refusal;
    if (typeof recusa === "string" && recusa !== "") {
      throw new Error(
        `O modelo se recusou a gerar o documento: ${recusa.slice(0, 300)}`,
      );
    }

    const texto = escolha?.message?.content ?? "";
    const fim = escolha?.finish_reason ?? null;
    if (fim === "length") {
      throw new Error(
        "A resposta do modelo foi cortada no limite de tamanho — a consulta é " +
          "longa demais para uma passada só com este modelo.",
      );
    }
    if (texto.trim() === "") {
      throw new Error(
        `O modelo respondeu vazio (finish_reason: ${fim ?? "desconhecido"}).`,
      );
    }

    return {
      text: texto,
      model: dados.model ?? this.model,
      usage: {
        inputTokens: dados.usage?.prompt_tokens ?? null,
        outputTokens: dados.usage?.completion_tokens ?? null,
      },
      finishReason: fim,
    };
  }

  /** Nunca repete a mensagem do fornecedor num 401: ela costuma trazer a chave mascarada. */
  private explicar(status: number, mensagem: string): string {
    if (status === 401 || status === 403) {
      return (
        `${this.name} recusou a chave de IA (HTTP ${status}). Confira a chave em ` +
        `Configurações → IA — ela pode ter sido revogada ou ficado sem crédito.`
      );
    }
    if (status === 404) {
      return `${this.name} não encontrou o modelo "${this.model}" (HTTP 404). Confira o nome em Configurações → IA.`;
    }
    if (status === 429) {
      return `${this.name} limitou o uso desta chave (HTTP 429): ${mensagem.slice(0, 300)}`;
    }
    return `${this.name} respondeu ${status}: ${mensagem.slice(0, 300)}`;
  }
}

/** A mensagem de erro no formato OpenAI — `{ error: { message } }` —, ou texto puro. */
function mensagemDoErro(texto: string): string | null {
  try {
    const dados = JSON.parse(texto) as { error?: { message?: unknown } | string };
    if (typeof dados.error === "string") return dados.error;
    if (typeof dados.error?.message === "string") return dados.error.message;
  } catch {
    // não é JSON
  }
  return texto.trim() === "" ? null : texto.slice(0, 500);
}
