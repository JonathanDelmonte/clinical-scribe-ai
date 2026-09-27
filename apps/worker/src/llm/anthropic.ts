/**
 * Anthropic (Claude) — formato próprio, muito usado (ADR-0003).
 *
 * O formato da resposta é cumprido por uma FERRAMENTA obrigatória: o modelo é
 * obrigado a "chamar" `registrar_documento`, e os argumentos dessa chamada
 * seguem o esquema pedido. É o caminho estável para JSON garantido na API de
 * mensagens — e o texto devolvido é exatamente esse JSON, então quem lê a
 * resposta não sabe, nem precisa saber, que houve ferramenta no meio.
 */

import type {
  FormatoDaResposta,
  LlmCompletion,
  LlmDataPolicy,
  LlmProvider,
} from "@scribe/core";

import { dormirPadrao, esperaSugerida, type Dormir } from "./espera.js";

const RAIZ = "https://api.anthropic.com";
const VERSAO_DA_API = "2023-06-01";
const FERRAMENTA = "registrar_documento";
const MAX_TENTATIVAS = 4;
const ESPERA_PADRAO_MS = 10_000;

interface RespostaMensagem {
  model?: string;
  content?: (
    | { type: "text"; text?: string }
    | { type: "tool_use"; name?: string; input?: unknown }
    | { type: string }
  )[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface OpcoesAnthropic {
  readonly chave: string;
  readonly modelo: string;
  readonly politica: LlmDataPolicy;
  readonly fetchImpl?: typeof fetch;
  readonly dormir?: Dormir;
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly model: string;
  readonly dataPolicy: LlmDataPolicy;
  private readonly chave: string;
  private readonly fetchImpl: typeof fetch;
  private readonly dormir: Dormir;

  constructor(opcoes: OpcoesAnthropic) {
    this.model = opcoes.modelo;
    this.dataPolicy = opcoes.politica;
    this.chave = opcoes.chave;
    this.fetchImpl = opcoes.fetchImpl ?? fetch;
    this.dormir = opcoes.dormir ?? dormirPadrao;
  }

  private get cabecalhos(): Record<string, string> {
    return {
      "x-api-key": this.chave,
      "anthropic-version": VERSAO_DA_API,
      "content-type": "application/json",
    };
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${RAIZ}/v1/models`, {
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
      max_tokens: 8192,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
      ...(formato === undefined
        ? {}
        : {
            tools: [
              {
                name: FERRAMENTA,
                description: `Registra o documento pedido (${formato.nome}), no formato exigido.`,
                input_schema: formato.esquema,
              },
            ],
            tool_choice: { type: "tool", name: FERRAMENTA },
          }),
    };

    let ultimoErro = "";
    let semTemperatura = false;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      const res = await this.fetchImpl(`${RAIZ}/v1/messages`, {
        method: "POST",
        headers: this.cabecalhos,
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(180_000),
      });

      if (res.ok) {
        return this.lerResposta((await res.json()) as RespostaMensagem, formato);
      }

      const texto = await res.text().catch(() => "");
      ultimoErro = mensagemDoErro(texto) ?? `HTTP ${res.status}`;

      // Algum modelo que não aceite temperatura explícita: sai o campo, segue
      // o pedido — ver o mesmo cuidado no adaptador compatível com OpenAI.
      if (res.status === 400 && !semTemperatura && /temperature/i.test(ultimoErro)) {
        delete corpo["temperature"];
        semTemperatura = true;
        tentativa--;
        continue;
      }

      // 429 é ritmo; 529 é "sobrecarregado", próprio da Anthropic; 5xx passa.
      const vaiPassar = res.status === 429 || res.status >= 500;
      if (!vaiPassar || tentativa === MAX_TENTATIVAS) {
        throw new Error(this.explicar(res.status, ultimoErro));
      }
      await this.dormir(esperaSugerida(res) ?? ESPERA_PADRAO_MS * tentativa);
    }

    throw new Error(ultimoErro);
  }

  private lerResposta(
    dados: RespostaMensagem,
    formato: FormatoDaResposta | undefined,
  ): LlmCompletion {
    if (dados.stop_reason === "max_tokens") {
      throw new Error(
        "A resposta do modelo foi cortada no limite de tamanho — a consulta é " +
          "longa demais para uma passada só com este modelo.",
      );
    }

    const blocos = dados.content ?? [];
    let texto = "";
    if (formato !== undefined) {
      const chamada = blocos.find(
        (b): b is { type: "tool_use"; name?: string; input?: unknown } =>
          b.type === "tool_use" && "name" in b && b.name === FERRAMENTA,
      );
      if (chamada !== undefined && chamada.input !== undefined) {
        texto = JSON.stringify(chamada.input);
      }
    }
    if (texto === "") {
      texto = blocos
        .map((b) => (b.type === "text" && "text" in b ? (b.text ?? "") : ""))
        .join("");
    }
    if (texto.trim() === "") {
      throw new Error(
        `O modelo respondeu vazio (stop_reason: ${dados.stop_reason ?? "desconhecido"}).`,
      );
    }

    return {
      text: texto,
      model: dados.model ?? this.model,
      usage: {
        inputTokens: dados.usage?.input_tokens ?? null,
        outputTokens: dados.usage?.output_tokens ?? null,
      },
      finishReason: dados.stop_reason ?? null,
    };
  }

  private explicar(status: number, mensagem: string): string {
    if (status === 401 || status === 403) {
      return (
        `A Anthropic recusou a chave de IA (HTTP ${status}). Confira a chave em ` +
        `Configurações → IA — ela pode ter sido revogada ou ficado sem crédito.`
      );
    }
    if (status === 404) {
      return `A Anthropic não encontrou o modelo "${this.model}" (HTTP 404). Confira o nome em Configurações → IA.`;
    }
    return `A Anthropic respondeu ${status}: ${mensagem.slice(0, 300)}`;
  }
}

/** A mensagem de erro no formato da Anthropic — `{ error: { message } }`. */
function mensagemDoErro(texto: string): string | null {
  try {
    const dados = JSON.parse(texto) as { error?: { message?: unknown } };
    if (typeof dados.error?.message === "string") return dados.error.message;
  } catch {
    // não é JSON
  }
  return texto.trim() === "" ? null : texto.slice(0, 500);
}
