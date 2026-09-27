import { FORMATO_DA_NOTA } from "@scribe/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnthropicLlmProvider } from "./anthropic.js";
import { GoogleLlmProvider } from "./google.js";
import { OpenAiCompativelLlmProvider } from "./openai.js";

/** Um fornecedor de mentira: responde na ordem dada e guarda cada pedido. */
function fornecedorFalso(respostas: Response[]) {
  const pedidos: { url: string; init: RequestInit; corpo: Record<string, unknown> }[] =
    [];
  const fetchFalso = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    pedidos.push({
      url: String(url),
      init: init ?? {},
      corpo: init?.body === undefined ? {} : JSON.parse(String(init.body)),
    });
    const resposta = respostas.shift();
    if (resposta === undefined) throw new Error("pedido a mais");
    return Promise.resolve(resposta);
  });
  return { pedidos, fetch: fetchFalso as unknown as typeof fetch };
}

const json = (dados: unknown, status = 200, cabecalhos: Record<string, string> = {}) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json", ...cabecalhos },
  });

const nota = { secoes: [{ chave: "plano", afirmacoes: [] }] };
const semDormir = () => Promise.resolve();

describe("compatível com OpenAI", () => {
  const criar = (f: typeof fetch) =>
    new OpenAiCompativelLlmProvider({
      nome: "compativel:api.groq.com",
      raiz: "https://api.groq.com/openai/",
      chave: "sk-teste",
      modelo: "llama",
      politica: "contractual",
      fetchImpl: f,
      dormir: semDormir,
    });

  it("pede o formato por esquema, com temperatura zero, em <raiz>/v1", async () => {
    const f = fornecedorFalso([
      json({
        model: "llama",
        choices: [
          { message: { content: JSON.stringify(nota) }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    ]);
    const r = await criar(f.fetch).complete("prompt", FORMATO_DA_NOTA);
    const [pedido] = f.pedidos;
    expect(pedido?.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(new Headers(pedido?.init.headers).get("authorization")).toBe(
      "Bearer sk-teste",
    );
    expect(pedido?.corpo).toMatchObject({
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name: "nota_clinica", schema: FORMATO_DA_NOTA.esquema },
      },
    });
    expect(JSON.parse(r.text)).toEqual(nota);
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  // Modelos de raciocínio recusam temperatura; servidores simples, o esquema.
  it("tira o campo que o serviço recusa pelo nome, e segue", async () => {
    const f = fornecedorFalso([
      json(
        { error: { message: "Unsupported value: 'temperature' does not support 0" } },
        400,
      ),
      json({ error: { message: "response_format json_schema is not supported" } }, 400),
      json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }),
    ]);
    await criar(f.fetch).complete("prompt", FORMATO_DA_NOTA);
    expect(f.pedidos).toHaveLength(3);
    expect(f.pedidos[2]?.corpo).not.toHaveProperty("temperature");
    expect(f.pedidos[2]?.corpo).not.toHaveProperty("response_format");
  });

  it("429 espera o que o serviço pediu e tenta de novo", async () => {
    const dormir = vi.fn(semDormir);
    const f = fornecedorFalso([
      json({ error: { message: "rate limit" } }, 429, { "retry-after": "3" }),
      json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }),
    ]);
    await new OpenAiCompativelLlmProvider({
      nome: "openai",
      raiz: "https://api.openai.com",
      chave: "sk-teste",
      modelo: "m",
      politica: "contractual",
      fetchImpl: f.fetch,
      dormir,
    }).complete("prompt");
    expect(dormir).toHaveBeenCalledWith(3000);
  });

  // A mensagem do fornecedor num 401 costuma repetir a chave mascarada.
  it("chave recusada: motivo nosso, sem repetir a mensagem do fornecedor", async () => {
    const f = fornecedorFalso([
      json({ error: { message: "Incorrect API key provided: sk-tes****" } }, 401),
    ]);
    const erro = await criar(f.fetch)
      .complete("prompt")
      .catch((e: unknown) => e);
    expect(String(erro)).toMatch(/recusou a chave/);
    expect(String(erro)).not.toMatch(/sk-/);
  });

  it("resposta cortada no limite é erro, não nota pela metade", async () => {
    const f = fornecedorFalso([
      json({
        choices: [{ message: { content: '{"secoes": [' }, finish_reason: "length" }],
      }),
    ]);
    await expect(criar(f.fetch).complete("prompt")).rejects.toThrow(/cortada/);
  });
});

describe("Anthropic", () => {
  const criar = (f: typeof fetch) =>
    new AnthropicLlmProvider({
      chave: "sk-ant-teste",
      modelo: "claude-sonnet-5",
      politica: "contractual",
      fetchImpl: f,
      dormir: semDormir,
    });

  it("força a ferramenta com o esquema pedido e devolve os argumentos como JSON", async () => {
    const f = fornecedorFalso([
      json({
        model: "claude-sonnet-5",
        content: [{ type: "tool_use", name: "registrar_documento", input: nota }],
        stop_reason: "tool_use",
        usage: { input_tokens: 12, output_tokens: 7 },
      }),
    ]);
    const r = await criar(f.fetch).complete("prompt", FORMATO_DA_NOTA);
    const [pedido] = f.pedidos;
    expect(pedido?.url).toBe("https://api.anthropic.com/v1/messages");
    const cabecalhos = new Headers(pedido?.init.headers);
    expect(cabecalhos.get("x-api-key")).toBe("sk-ant-teste");
    expect(cabecalhos.get("anthropic-version")).toBe("2023-06-01");
    expect(pedido?.corpo).toMatchObject({
      temperature: 0,
      tools: [{ name: "registrar_documento", input_schema: FORMATO_DA_NOTA.esquema }],
      tool_choice: { type: "tool", name: "registrar_documento" },
    });
    expect(JSON.parse(r.text)).toEqual(nota);
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });

  it("529 (sobrecarregado) passa com nova tentativa", async () => {
    const f = fornecedorFalso([
      json({ error: { message: "Overloaded" } }, 529),
      json({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" }),
    ]);
    await expect(criar(f.fetch).complete("prompt")).resolves.toMatchObject({
      text: "{}",
    });
  });

  it("parada no limite de tamanho é erro", async () => {
    const f = fornecedorFalso([
      json({
        content: [{ type: "tool_use", name: "registrar_documento", input: {} }],
        stop_reason: "max_tokens",
      }),
    ]);
    await expect(criar(f.fetch).complete("prompt", FORMATO_DA_NOTA)).rejects.toThrow(
      /cortada/,
    );
  });
});

describe("Google", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("chave no cabeçalho, nunca na URL; esquema só quando pedido", async () => {
    const f = fornecedorFalso([
      json({
        candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }],
      }),
      json({
        candidates: [{ content: { parts: [{ text: "texto" }] }, finishReason: "STOP" }],
      }),
    ]);
    vi.stubGlobal("fetch", f.fetch);
    const google = new GoogleLlmProvider(
      "AIza-teste",
      "gemini",
      "contractual",
      "google",
    );

    await google.complete("prompt", FORMATO_DA_NOTA);
    await google.complete("prompt");

    for (const pedido of f.pedidos) {
      expect(pedido.url).not.toContain("AIza-teste");
      expect(new Headers(pedido.init.headers).get("x-goog-api-key")).toBe("AIza-teste");
    }
    const [comFormato, semFormato] = f.pedidos;
    expect(comFormato?.corpo["generationConfig"]).toMatchObject({
      responseMimeType: "application/json",
      responseSchema: FORMATO_DA_NOTA.esquema,
    });
    expect(semFormato?.corpo["generationConfig"]).not.toHaveProperty("responseSchema");
    expect(google.dataPolicy).toBe("contractual");
  });
});
