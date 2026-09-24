import { describe, expect, it } from "vitest";

import {
  CABECALHO_ENVELOPE,
  codificarEnvelope,
  energiaPorPasso,
  lerCabecalhoDoEnvelope,
  MAX_BYTES_ENVELOPE,
  MAX_PASSOS_ENVELOPE,
} from "./envelope";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("energiaPorPasso", () => {
  it("energia média do quadrado, por passo", () => {
    const sinal = new Float32Array(160).fill(0.5);
    expect([...energiaPorPasso([sinal])]).toEqual([0.25, 0.25]);
  });

  it("descarta o passo incompleto do fim", () => {
    expect(energiaPorPasso([new Float32Array(239).fill(1)])).toHaveLength(2);
  });

  // A mistura é a média dos canais, como em prepare.ts. Canais em oposição de
  // fase se anulam — é o que o mono do áudio principal também faria.
  it("mistura os canais pela média", () => {
    const l = new Float32Array(80).fill(0.5);
    const r = new Float32Array(80).fill(-0.5);
    expect([...energiaPorPasso([l, r])]).toEqual([0]);
    expect([...energiaPorPasso([l, l])]).toEqual([0.25]);
    expect([...energiaPorPasso([l, l, l])]).toEqual([0.25]);
  });

  it("sem canal nenhum, nenhum passo", () => {
    expect(energiaPorPasso([])).toHaveLength(0);
  });
});

describe("codificarEnvelope", () => {
  /**
   * O vetor de ouro: bytes produzidos por `canais.codificar_envelope`, NO
   * MOTOR, para a mesma entrada. Se este teste quebrar, o navegador e o motor
   * deixaram de concordar sobre o formato — e o motor passaria a ler números
   * que não são o que o navegador mediu.
   *
   *   docker exec scribe-asr-local python3 -c "import sys; sys.path.insert(0, '/app');
   *     import numpy as np, canais;
   *     print(canais.codificar_envelope(np.array([0.25, 0.0, 1.0, 1e-3, 3.3e-7])).hex())"
   */
  it("escreve exatamente o que o motor escreve", () => {
    expect(hex(codificarEnvelope([0.25, 0, 1, 1e-3, 3.3e-7]))).toBe(
      "43564531803e00005000000005000000a6fdf0d8000048f4afe6",
    );
  });

  it("ida e volta pelo cabeçalho", () => {
    const bytes = codificarEnvelope(new Float64Array(200 * 60)); // 1 minuto
    expect(bytes.byteLength).toBe(CABECALHO_ENVELOPE + 2 * 200 * 60);
    expect(lerCabecalhoDoEnvelope(bytes)).toEqual({
      ok: true,
      passos: 12_000,
      duracaoS: 60,
    });
  });

  it("recusa gravação acima do limite", () => {
    expect(() => codificarEnvelope({ length: MAX_PASSOS_ENVELOPE + 1 })).toThrow(
      /4 horas/,
    );
  });
});

describe("lerCabecalhoDoEnvelope", () => {
  const bom = codificarEnvelope(new Float64Array(1000).fill(0.01));

  // O caso que o tamanho exato existe para pegar: o corpo cortado no caminho
  // chega com o cabeçalho intacto e menos passos do que anuncia.
  it("recusa envelope cortado", () => {
    const r = lerCabecalhoDoEnvelope(bom.subarray(0, bom.byteLength - 2));
    expect(r.ok).toBe(false);
  });

  it("recusa o que não é envelope", () => {
    const outro = bom.slice();
    outro.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF" — um WAV mandado no lugar
    expect(lerCabecalhoDoEnvelope(outro).ok).toBe(false);
  });

  it("recusa passo diferente do que o motor espera", () => {
    const outro = bom.slice();
    new DataView(outro.buffer).setUint16(8, 160, true);
    expect(lerCabecalhoDoEnvelope(outro).ok).toBe(false);
  });

  it("recusa vazio", () => {
    expect(lerCabecalhoDoEnvelope(new Uint8Array(0)).ok).toBe(false);
  });

  it("lê de um pedaço no meio de um buffer maior", () => {
    const maior = new Uint8Array(bom.byteLength + 10);
    maior.set(bom, 10);
    expect(lerCabecalhoDoEnvelope(maior.subarray(10)).ok).toBe(true);
  });
});

describe("o limite", () => {
  // Acima de 10 MB o Next corta o corpo sem avisar. O maior envelope aceito
  // precisa caber abaixo disso, com folga.
  it("o maior envelope cabe no corpo de uma requisição", () => {
    expect(MAX_BYTES_ENVELOPE).toBeLessThan(10 * 1024 * 1024);
  });
});
