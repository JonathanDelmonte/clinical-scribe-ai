/**
 * Os fornecedores de IA que o profissional pode ligar, e como conferir a chave.
 *
 * ## Por que um "compatível com OpenAI" na lista
 *
 * Não é preguiça: é o formato que virou padrão de fato. Groq, Together,
 * OpenRouter, DeepSeek, Mistral, vLLM e Ollama auto-hospedados falam todos o
 * mesmo dialeto. Um adaptador com endereço configurável atende essa lista
 * inteira — e a próxima que aparecer — sem uma linha nova.
 *
 * ## Por que verificar a chave na hora de salvar
 *
 * Uma chave errada guardada em silêncio falha depois, no meio de uma consulta,
 * num job do worker, com uma mensagem de autenticação que não diz nada sobre
 * ter sido digitada errada duas semanas antes. Uma chamada barata agora move
 * essa descoberta para o instante em que a pessoa está olhando o campo.
 */

export interface FornecedorSpec {
  readonly id: string;
  readonly nome: string;
  /** Como a interface descreve onde conseguir a chave. */
  readonly ondeConseguir: string;
  readonly exemploModelo: string;
  /** Endereço próprio faz sentido para este fornecedor? */
  readonly aceitaBaseUrl: boolean;
  /** Ponto de verificação e como autenticar. */
  readonly verificacao: {
    readonly caminho: string;
    readonly cabecalho: (chave: string) => Record<string, string>;
    readonly padraoBaseUrl: string;
  };
}

export const FORNECEDORES: readonly FornecedorSpec[] = [
  {
    id: "anthropic",
    nome: "Anthropic (Claude)",
    ondeConseguir: "console.anthropic.com → API Keys",
    exemploModelo: "claude-sonnet-5",
    aceitaBaseUrl: false,
    verificacao: {
      padraoBaseUrl: "https://api.anthropic.com",
      caminho: "/v1/models",
      cabecalho: (chave) => ({
        "x-api-key": chave,
        "anthropic-version": "2023-06-01",
      }),
    },
  },
  {
    id: "openai",
    nome: "OpenAI (ChatGPT)",
    ondeConseguir: "platform.openai.com → API keys",
    exemploModelo: "gpt-5",
    aceitaBaseUrl: false,
    verificacao: {
      padraoBaseUrl: "https://api.openai.com",
      caminho: "/v1/models",
      cabecalho: (chave) => ({ authorization: `Bearer ${chave}` }),
    },
  },
  {
    id: "google",
    nome: "Google (Gemini)",
    ondeConseguir: "aistudio.google.com/apikey",
    exemploModelo: "gemini-3.8-flash",
    aceitaBaseUrl: false,
    verificacao: {
      padraoBaseUrl: "https://generativelanguage.googleapis.com",
      caminho: "/v1beta/models",
      cabecalho: () => ({}),
    },
  },
  {
    id: "compativel",
    nome: "Outro compatível com OpenAI",
    ondeConseguir: "Groq, Together, OpenRouter, DeepSeek, vLLM auto-hospedado…",
    exemploModelo: "llama-3.3-70b",
    aceitaBaseUrl: true,
    verificacao: {
      padraoBaseUrl: "",
      caminho: "/v1/models",
      cabecalho: (chave) => ({ authorization: `Bearer ${chave}` }),
    },
  },
];

export interface Verificacao {
  readonly ok: boolean;
  readonly motivo?: string;
}

/**
 * Confere se a chave funciona, sem gastar geração.
 *
 * Lista modelos em vez de gerar texto: é a chamada mais barata que prova
 * autenticação, não costuma consumir cota, e devolve 401 de forma inequívoca
 * quando a chave está errada.
 */
export async function verificarChave(
  spec: FornecedorSpec,
  chave: string,
  modelo: string,
  baseUrl: string,
): Promise<Verificacao> {
  const raiz = (baseUrl !== "" ? baseUrl : spec.verificacao.padraoBaseUrl).replace(
    /\/+$/,
    "",
  );
  if (raiz === "") {
    return { ok: false, motivo: "informe o endereço do serviço" };
  }

  // O Google autentica por parâmetro de consulta, não por cabeçalho.
  const url =
    spec.id === "google"
      ? `${raiz}${spec.verificacao.caminho}?key=${encodeURIComponent(chave)}`
      : `${raiz}${spec.verificacao.caminho}`;

  try {
    const res = await fetch(url, {
      headers: spec.verificacao.cabecalho(chave),
      // Curto de propósito: a pessoa está esperando na tela, e um fornecedor
      // que demora dez segundos para dizer "ok" não vai servir para gerar nota.
      signal: AbortSignal.timeout(12_000),
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, motivo: `${spec.nome} recusou esta chave.` };
    }
    if (res.status === 404) {
      return {
        ok: false,
        motivo: "O endereço respondeu, mas não parece ser uma API compatível.",
      };
    }
    if (!res.ok) {
      return { ok: false, motivo: `${spec.nome} respondeu ${res.status}.` };
    }

    // Só avisa quando dá para ter certeza: nem toda lista de modelos usa o
    // mesmo formato, e transformar "não achei o nome" em erro barraria chave
    // boa por causa de um detalhe de resposta.
    const corpo = await res.text();
    if (corpo.length > 0 && corpo.includes('"') && !corpo.includes(modelo)) {
      return {
        ok: true,
        motivo:
          `A chave funciona, mas "${modelo}" não apareceu na lista de modelos ` +
          `desta conta. Confira o nome se a geração falhar.`,
      };
    }
    return { ok: true };
  } catch (erro) {
    const timeout = erro instanceof Error && erro.name === "TimeoutError";
    return {
      ok: false,
      motivo: timeout
        ? "O serviço não respondeu a tempo."
        : "Não foi possível falar com o serviço. Confira o endereço e a conexão.",
    };
  }
}
