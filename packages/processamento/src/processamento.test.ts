import { describe, expect, it } from "vitest";

import {
  chaveDaAmostraDeVoz,
  formatoParaGuardar,
  impressaoValida,
  juntarBytes,
  lerManifesto,
  lerPedidoDeVoz,
  lerResultado,
  type Guarda,
} from "./index";

const PROF = "6b4f3c1e-8f0a-4d2b-9c3e-1a2b3c4d5e6f";

describe("os pedaços da gravação", () => {
  it("o manifesto diz quantos são e o formato; o resto é ilegível", () => {
    const bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
    expect(lerManifesto(bytes({ partes: 3, extensao: "wav" }))).toEqual({
      partes: 3,
      extensao: "wav",
    });
    expect(lerManifesto(bytes({ partes: 0, extensao: "wav" }))).toBeNull();
    expect(lerManifesto(bytes({ partes: 3, extensao: "../x" }))).toBeNull();
    expect(lerManifesto(new TextEncoder().encode("{"))).toBeNull();
  });

  it("junta na ordem, sem buracos", () => {
    const juntado = juntarBytes([
      new Uint8Array([1, 2]),
      new Uint8Array([3]),
      new Uint8Array([4, 5]),
    ]);
    expect(juntado.ok && [...juntado.bytes]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("o que fica guardado da consulta", () => {
  const guarda = (wavDoNavegador: boolean): Guarda => ({
    wavDoNavegador,
    limiteBytes: 1000,
    chaveWav: "a.wav",
    chaveM4a: "a.m4a",
    obrigatoria: false,
  });

  it("o WAV do navegador fica como está, se couber num arquivo", () => {
    expect(formatoParaGuardar(guarda(true), 1000)).toBe("wav");
    expect(formatoParaGuardar(guarda(true), 1001)).toBe("m4a");
  });

  it("o resto vira a cópia comprimida", () => {
    expect(formatoParaGuardar(guarda(false), 10)).toBe("m4a");
  });
});

describe("o resultado que um ajudante devolve", () => {
  const valido = {
    engine: "local",
    model: "large-v3",
    language: "pt",
    durationMs: 60_000,
    processingMs: 9_000,
    realtimeFactor: 6.7,
    diarizationApplied: true,
    diarizationError: null,
    voiceMatchingApplied: false,
    truncated: false,
    uncoveredMs: 0,
    speakers: ["SPEAKER_00", "SPEAKER_01"],
    segments: [
      {
        startMs: 0,
        endMs: 4_000,
        text: "Bom dia, o que trouxe você hoje?",
        speakerLabel: "SPEAKER_00",
        confidence: 0.91,
        voiceSimilarity: null,
      },
    ],
  };

  it("o formato do motor passa", () => {
    const lido = lerResultado(valido);
    expect(lido.ok && lido.resultado.segments).toHaveLength(1);
  });

  it("qualquer campo errado vira erro com o caminho, não um trecho estranho no prontuário", () => {
    const ruim = lerResultado({
      ...valido,
      segments: [{ ...valido.segments[0], startMs: -5 }],
    });
    expect(ruim).toMatchObject({ ok: false });
    expect(!ruim.ok && ruim.erro).toContain("segments.0.startMs");
    expect(lerResultado({ ...valido, engine: "cloud" }).ok).toBe(false);
    expect(lerResultado(null).ok).toBe(false);
  });
});

describe("o cadastro da voz pela fila", () => {
  it("a amostra fica na pasta do próprio profissional", () => {
    expect(chaveDaAmostraDeVoz(PROF, "abc123", "webm")).toBe(
      `${PROF}/perfil/amostra-de-voz-abc123.webm`,
    );
    // Extensão estranha não entra no nome do arquivo.
    expect(chaveDaAmostraDeVoz(PROF, "abc123", "../../x")).toBe(
      `${PROF}/perfil/amostra-de-voz-abc123.bin`,
    );
  });

  it("um pedido só vale para a amostra do dono do job", () => {
    const chave = chaveDaAmostraDeVoz(PROF, "abc123", "webm");
    expect(lerPedidoDeVoz({ chave, nome: "voz.webm" }, PROF)).toEqual({
      chave,
      nome: "voz.webm",
    });
    expect(
      lerPedidoDeVoz({ chave, nome: "voz.webm" }, "outro-profissional"),
    ).toBeNull();
    expect(lerPedidoDeVoz({ chave: `${PROF}/sessao.wav`, nome: "x" }, PROF)).toBeNull();
    expect(lerPedidoDeVoz(null, PROF)).toBeNull();
  });

  it("a impressão vocal são 256 números finitos", () => {
    expect(impressaoValida(Array.from({ length: 256 }, () => 0.1))).toBe(true);
    expect(impressaoValida(Array.from({ length: 255 }, () => 0.1))).toBe(false);
    expect(
      impressaoValida([...Array.from({ length: 255 }, () => 0.1), Number.NaN]),
    ).toBe(false);
  });
});
