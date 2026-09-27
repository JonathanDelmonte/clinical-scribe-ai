import { describe, expect, it, vi } from "vitest";

import {
  AVISO_ANTES_DO_LIMITE_S,
  esquecerPreparo,
  estadoDoLimite,
  LIMITE_GRAVACAO_S,
  limiteDePreparoS,
  prepararArquivoNoNavegador,
  prepararGravacaoNoNavegador,
  prepararSemRepetirQueda,
} from "./limite";

describe("limite da gravação", () => {
  it("é normal até faltarem 15 minutos", () => {
    expect(estadoDoLimite(0)).toEqual({ tipo: "normal" });
    expect(estadoDoLimite(LIMITE_GRAVACAO_S - AVISO_ANTES_DO_LIMITE_S - 1)).toEqual({
      tipo: "normal",
    });
  });

  it("avisa nos últimos 15 minutos, contando para baixo", () => {
    expect(estadoDoLimite(LIMITE_GRAVACAO_S - AVISO_ANTES_DO_LIMITE_S)).toEqual({
      tipo: "aviso",
      minutosRestantes: 15,
    });
    expect(estadoDoLimite(LIMITE_GRAVACAO_S - 30)).toEqual({
      tipo: "aviso",
      minutosRestantes: 1,
    });
  });

  it("encerra exatamente no limite de 3 horas", () => {
    expect(LIMITE_GRAVACAO_S).toBe(3 * 60 * 60);
    expect(estadoDoLimite(LIMITE_GRAVACAO_S)).toEqual({ tipo: "encerrar" });
    expect(estadoDoLimite(LIMITE_GRAVACAO_S + 5)).toEqual({ tipo: "encerrar" });
  });

  // 3 horas comprimidas (~14,7 MB/h) precisam caber nos 45 MB por arquivo.
  it("o limite cabe, comprimido, num arquivo do armazenamento gratuito", () => {
    expect((LIMITE_GRAVACAO_S / 3600) * 14.7).toBeLessThan(45);
  });
});

describe("onde a gravação é preparada", () => {
  it("aparelho com 8 GB ou mais: até 1 hora; os outros, até 30 minutos", () => {
    expect(limiteDePreparoS(8)).toBe(3600);
    expect(limiteDePreparoS(4)).toBe(1800);
    // Safari e Firefox não dizem quanta memória há: vale o cauteloso.
    expect(limiteDePreparoS(undefined)).toBe(1800);
  });

  it("conta a duração pelos pedaços de 5 segundos", () => {
    expect(prepararGravacaoNoNavegador(360)).toBe(true); // 30 min
    expect(prepararGravacaoNoNavegador(361)).toBe(false);
    expect(prepararGravacaoNoNavegador(720, 8)).toBe(true); // 60 min
    expect(prepararGravacaoNoNavegador(721, 8)).toBe(false);
  });

  it("arquivo: pela duração quando o navegador a sabe; senão, pelo tamanho", () => {
    expect(prepararArquivoNoNavegador(25 * 60, 500 * 1024 * 1024)).toBe(true);
    expect(prepararArquivoNoNavegador(45 * 60, 1024)).toBe(false);
    // Sem duração (WebM do MediaRecorder): 128 kbps estimados.
    expect(prepararArquivoNoNavegador(null, 20 * 1024 * 1024)).toBe(true);
    expect(prepararArquivoNoNavegador(null, 40 * 1024 * 1024)).toBe(false);
    expect(prepararArquivoNoNavegador(Number.POSITIVE_INFINITY, 40 * 1024 * 1024)).toBe(
      false,
    );
  });
});

function marcasFalsas() {
  const itens = new Map<string, string>();
  return {
    itens,
    getItem: (k: string) => itens.get(k) ?? null,
    setItem: (k: string, v: string) => void itens.set(k, v),
    removeItem: (k: string) => void itens.delete(k),
  };
}

describe("a aba que caiu no preparo não cai de novo", () => {
  it("prepara normalmente, e não deixa marca", async () => {
    const marcas = marcasFalsas();
    await expect(
      prepararSemRepetirQueda("sessao-1", () => Promise.resolve("wav"), marcas),
    ).resolves.toBe("wav");
    expect(marcas.itens.size).toBe(0);
  });

  it("um erro comum sobe como erro, e também não deixa marca", async () => {
    const marcas = marcasFalsas();
    await expect(
      prepararSemRepetirQueda(
        "sessao-1",
        () => Promise.reject(new Error("codec")),
        marcas,
      ),
    ).rejects.toThrow("codec");
    expect(marcas.itens.size).toBe(0);
  });

  it("se a última tentativa não terminou, pula o preparo", async () => {
    const marcas = marcasFalsas();
    // A aba morre no meio: o preparo nunca termina, e a marca fica.
    void prepararSemRepetirQueda(
      "sessao-1",
      () => new Promise<never>(() => {}),
      marcas,
    );
    expect(marcas.itens.size).toBe(1);

    const preparar = vi.fn(() => Promise.resolve("wav"));
    await expect(prepararSemRepetirQueda("sessao-1", preparar, marcas)).resolves.toBe(
      null,
    );
    expect(preparar).not.toHaveBeenCalled();
    // Outra gravação não tem nada com isso.
    await expect(
      prepararSemRepetirQueda("sessao-2", () => Promise.resolve("wav"), marcas),
    ).resolves.toBe("wav");

    // Enviada ou descartada, a marca some — e a gravação seguinte prepara.
    esquecerPreparo("sessao-1", marcas);
    await expect(prepararSemRepetirQueda("sessao-1", preparar, marcas)).resolves.toBe(
      "wav",
    );
  });

  it("sem onde marcar, prepara sem a proteção", async () => {
    await expect(
      prepararSemRepetirQueda("sessao-1", () => Promise.resolve("wav"), null),
    ).resolves.toBe("wav");
  });
});
