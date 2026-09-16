/**
 * Motor de LLM — Google AI Studio (Gemini).
 *
 * Escolhido para o desenvolvimento porque tem nível gratuito de verdade: chave
 * criada em minutos, sem cartão. O preço é a política de dados — o nível grátis
 * registra os prompts e treina com eles — e é por isso que este provedor se
 * declara `training`. Ver `checkDataPolicy` em @scribe/core.
 *
 * O mesmo código atende ao caminho pago: Vertex AI roda os mesmos modelos sob
 * termos de não-treinamento e com região em São Paulo. A migração é trocar
 * `baseUrl`, a autenticação e a política declarada — não reescrever o adaptador.
 */

import {
  NOTE_RESPONSE_SCHEMA,
  type LlmCompletion,
  type LlmProvider,
} from "@scribe/core";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Categorias de segurança, todas desligadas — e isto é necessário, não descuido.
 *
 * Os filtros são treinados para conteúdo geral, e consulta clínica cruza os
 * quatro sem esforço: dermatologia e ginecologia disparam `SEXUALLY_EXPLICIT`;
 * ideação suicida e dose de medicamento disparam `DANGEROUS_CONTENT`. O
 * bloqueio chega como resposta vazia com `finishReason: "SAFETY"`.
 *
 * Pense no que isso significaria em produção: a consulta mais delicada do dia é
 * exatamente a que não geraria nota. O filtro falharia com mais frequência
 * justamente onde o registro importa mais.
 */
const SAFETY_SETTINGS = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

/** O nível grátis limita requisições por minuto. Tentar de novo é o normal. */
const MAX_TENTATIVAS = 4;
const ESPERA_PADRAO_MS = 20_000;

interface GeminiResposta {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

interface GeminiErro {
  error?: {
    message?: string;
    status?: string;
    details?: { "@type"?: string; retryDelay?: string }[];
  };
}

export class GoogleLlmProvider implements LlmProvider {
  readonly name = "google-ai-studio";
  readonly dataPolicy = "training" as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/models/${this.model}?key=${this.apiKey}`, {
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(prompt: string): Promise<LlmCompletion> {
    let ultimoErro = "";

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      const res = await fetch(
        `${BASE_URL}/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            safetySettings: SAFETY_SETTINGS,
            generationConfig: {
              // Zero de propósito. Nota clínica não é lugar para variedade:
              // a mesma consulta deve produzir a mesma nota, senão não há como
              // investigar uma regressão de qualidade depois.
              temperature: 0,
              responseMimeType: "application/json",
              responseSchema: NOTE_RESPONSE_SCHEMA,
              maxOutputTokens: 8192,
            },
          }),
          signal: AbortSignal.timeout(120_000),
        },
      );

      if (res.ok) {
        return this.lerResposta((await res.json()) as GeminiResposta);
      }

      const corpo = (await res.json().catch(() => null)) as GeminiErro | null;
      ultimoErro = corpo?.error?.message ?? `HTTP ${res.status}`;

      // 429 = cota por minuto do nível grátis. Não é falha, é ritmo.
      // 503 = modelo sobrecarregado; também passa.
      const vaiPassar = res.status === 429 || res.status === 503;
      if (!vaiPassar || tentativa === MAX_TENTATIVAS) {
        throw new Error(this.explicar(res.status, ultimoErro));
      }

      await dormir(esperaSugerida(corpo) ?? ESPERA_PADRAO_MS * tentativa);
    }

    throw new Error(ultimoErro);
  }

  private lerResposta(dados: GeminiResposta): LlmCompletion {
    const bloqueio = dados.promptFeedback?.blockReason;
    if (bloqueio !== undefined) {
      throw new Error(
        `O Google bloqueou a transcrição antes de processá-la (${bloqueio}). ` +
          `Conteúdo clínico às vezes dispara os filtros mesmo desligados.`,
      );
    }

    const candidato = dados.candidates?.[0];
    const texto = candidato?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const finishReason = candidato?.finishReason ?? null;

    if (texto === "") {
      throw new Error(
        `O modelo respondeu vazio (finishReason: ${finishReason ?? "desconhecido"}). ` +
          (finishReason === "MAX_TOKENS"
            ? "A consulta é longa demais para uma passada só."
            : "Tente novamente; se persistir, troque LLM_MODEL."),
      );
    }

    return {
      text: texto,
      model: this.model,
      finishReason,
      usage: {
        inputTokens: dados.usageMetadata?.promptTokenCount ?? null,
        outputTokens: dados.usageMetadata?.candidatesTokenCount ?? null,
      },
    };
  }

  /** Transforma o erro do fornecedor em instrução de o que fazer. */
  private explicar(status: number, mensagem: string): string {
    if (status === 400 && /API key not valid/i.test(mensagem)) {
      return (
        "Chave do Google recusada. Gere uma em https://aistudio.google.com/apikey " +
        "e coloque em GOOGLE_API_KEY no .env."
      );
    }
    if (status === 404) {
      return (
        `O modelo "${this.model}" não existe ou não está disponível para esta ` +
        `chave. Rode \`pnpm llm:models\` para ver os que a sua chave acessa.`
      );
    }
    if (status === 429) {
      return (
        `Cota do Google esgotada: ${mensagem}\n` +
        `O nível gratuito limita requisições por minuto e por dia. ` +
        `Espere e tente de novo, ou use um modelo "flash", que tem cota maior.`
      );
    }
    return `Google respondeu ${status}: ${mensagem}`;
  }
}

/** O Google costuma dizer quanto esperar. Obedecer é melhor que adivinhar. */
function esperaSugerida(corpo: GeminiErro | null): number | null {
  const detalhe = corpo?.error?.details?.find((d) => d["@type"]?.includes("RetryInfo"));
  const bruto = detalhe?.retryDelay;
  if (bruto === undefined) return null;
  const segundos = Number.parseFloat(bruto.replace(/s$/, ""));
  return Number.isFinite(segundos) ? Math.ceil(segundos * 1000) + 500 : null;
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
