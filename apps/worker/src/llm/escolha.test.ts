import type { LlmDataPolicy, LlmProvider } from "@scribe/core";
import { describe, expect, it, vi } from "vitest";

import {
  criarEscolhaDeLlm,
  fabricarProvedor,
  type ChaveAberta,
  type ChaveCadastrada,
} from "./escolha.js";

function provedor(nome: string, politica: LlmDataPolicy): LlmProvider {
  return {
    name: nome,
    model: "modelo",
    dataPolicy: politica,
    healthy: () => Promise.resolve(true),
    complete: () => Promise.reject(new Error("não usado")),
  };
}

const daInstalacao = provedor("google-ai-studio", "training");

const cadastrada = (politica: LlmDataPolicy = "contractual"): ChaveCadastrada => ({
  fornecedor: "anthropic",
  modelo: "claude-sonnet-5",
  cifra: "cifrado",
  baseUrl: null,
  politica,
});

describe("qual modelo gera o documento", () => {
  it("sem chave própria, o da instalação", async () => {
    const escolher = criarEscolhaDeLlm({
      lerChave: () => Promise.resolve(null),
      instalacao: { provider: daInstalacao, blockedReason: null },
      aceita: "training",
    });
    const escolha = await escolher("prof-1");
    expect(escolha).toMatchObject({ ok: true, daChaveDoProfissional: false });
    expect(escolha.ok && escolha.provider).toBe(daInstalacao);
  });

  it("com chave própria, a do profissional — aberta e com a política que ele declarou", async () => {
    const fabricar = vi.fn((c: ChaveAberta) => provedor(c.fornecedor, c.politica));
    const escolher = criarEscolhaDeLlm({
      lerChave: () => Promise.resolve(cadastrada("contractual")),
      instalacao: { provider: daInstalacao, blockedReason: null },
      aceita: "contractual",
      abrir: (cifra) => `aberta(${cifra})`,
      fabricar,
    });
    const escolha = await escolher("prof-1");
    expect(escolha).toMatchObject({ ok: true, daChaveDoProfissional: true });
    expect(fabricar).toHaveBeenCalledWith({
      fornecedor: "anthropic",
      modelo: "claude-sonnet-5",
      chave: "aberta(cifrado)",
      baseUrl: null,
      politica: "contractual",
    });
  });

  // ADR-0003: "nossa chave como reserva" é conta surpresa.
  it("chave própria que não abre NÃO cai para a da instalação", async () => {
    const escolher = criarEscolhaDeLlm({
      lerChave: () => Promise.resolve(cadastrada()),
      instalacao: { provider: daInstalacao, blockedReason: null },
      aceita: "training",
      abrir: () => {
        throw new Error("chave-mestra diferente");
      },
    });
    const escolha = await escolher("prof-1");
    expect(escolha.ok).toBe(false);
    expect(!escolha.ok && escolha.motivo).toMatch(/SEGREDO_MESTRE/);
  });

  // ADR-0003, regra 5: ser a chave do profissional não muda o que o
  // fornecedor faz com a consulta.
  it("chave de nível gratuito é recusada onde se exige não-treinamento", async () => {
    const escolher = criarEscolhaDeLlm({
      lerChave: () => Promise.resolve(cadastrada("training")),
      instalacao: { provider: provedor("pago", "contractual"), blockedReason: null },
      aceita: "contractual",
      abrir: () => "sk-teste",
      fabricar: (c) => provedor(c.fornecedor, c.politica),
    });
    const escolha = await escolher("prof-1");
    expect(escolha.ok).toBe(false);
    expect(!escolha.ok && escolha.motivo).toMatch(/nível gratuito/);
  });

  it("fornecedor que a estação não conhece vira motivo, não exceção", async () => {
    const escolher = criarEscolhaDeLlm({
      lerChave: () => Promise.resolve({ ...cadastrada(), fornecedor: "novo" }),
      instalacao: { provider: null, blockedReason: "sem chave" },
      aceita: "training",
      abrir: () => "sk-teste",
    });
    const escolha = await escolher("prof-1");
    expect(!escolha.ok && escolha.motivo).toMatch(/"novo"/);
  });

  it("sem chave própria e sem modelo na instalação, diz o que fazer", async () => {
    const escolher = criarEscolhaDeLlm({
      lerChave: () => Promise.resolve(null),
      instalacao: { provider: null, blockedReason: "sem chave" },
      aceita: "training",
    });
    const escolha = await escolher("prof-1");
    expect(!escolha.ok && escolha.motivo).toMatch(/Ajustes/);
  });
});

describe("os fornecedores da tela de configurações", () => {
  const chave = (fornecedor: string, baseUrl: string | null = null): ChaveAberta => ({
    fornecedor,
    modelo: "m",
    chave: "sk-teste",
    baseUrl,
    politica: "contractual",
  });

  it("cada identificador vira o adaptador certo, com a política declarada", () => {
    expect(fabricarProvedor(chave("google"))?.name).toBe("google");
    expect(fabricarProvedor(chave("openai"))?.name).toBe("openai");
    expect(fabricarProvedor(chave("anthropic"))?.name).toBe("anthropic");
    expect(
      fabricarProvedor(chave("compativel", "https://api.groq.com/openai"))?.name,
    ).toBe("compativel:api.groq.com");
    expect(fabricarProvedor(chave("google"))?.dataPolicy).toBe("contractual");
  });

  it("compatível sem endereço não tem para onde ir", () => {
    expect(fabricarProvedor(chave("compativel"))).toBeNull();
    expect(fabricarProvedor(chave("desconhecido"))).toBeNull();
  });
});
