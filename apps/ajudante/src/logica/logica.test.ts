import { describe, expect, it } from "vitest";

import { ehNossoMotor, observar, type Vigia } from "./docker";
import { ETAPAS, percentual, tamanhoLegivel } from "./etapas";
import { espacoNecessario, lerNvidiaSmi, planejarMotor } from "./maquina";

describe("a placa de vídeo decide como o motor roda", () => {
  it("lê a saída do nvidia-smi", () => {
    expect(lerNvidiaSmi("NVIDIA GeForce RTX 3060, 12288, 581.57\r\n")).toEqual([
      { nome: "NVIDIA GeForce RTX 3060", memoriaMb: 12288, driver: "581.57" },
    ]);
    expect(lerNvidiaSmi("")).toEqual([]);
  });

  it("placa com folga: CUDA em float16", () => {
    const plano = planejarMotor(lerNvidiaSmi("NVIDIA GeForce RTX 3060, 12288, 581.57"));
    expect(plano).toMatchObject({ dispositivo: "cuda", computeType: "float16" });
    expect(plano.indiceDoTorch).toContain("cu124");
  });

  it("placa de 4 a 6 GB: CUDA em modo econômico", () => {
    const plano = planejarMotor(lerNvidiaSmi("NVIDIA GeForce GTX 1650, 4096, 560.94"));
    expect(plano).toMatchObject({ dispositivo: "cuda", computeType: "int8_float16" });
  });

  it("sem NVIDIA, driver velho ou pouca memória: processador, e a frase diz por quê", () => {
    expect(planejarMotor([]).dispositivo).toBe("cpu");
    const velho = planejarMotor(lerNvidiaSmi("NVIDIA GeForce RTX 2060, 6144, 472.12"));
    expect(velho.dispositivo).toBe("cpu");
    expect(velho.explicacao).toMatch(/driver/);
    const pouca = planejarMotor(lerNvidiaSmi("NVIDIA GeForce GT 1030, 2048, 560.94"));
    expect(pouca.dispositivo).toBe("cpu");
    expect(pouca.indiceDoTorch).toContain("/cpu");
  });

  it("a frase da tela não tem travessão (estilo do redesenho)", () => {
    for (const plano of [
      planejarMotor([]),
      planejarMotor(lerNvidiaSmi("NVIDIA GeForce RTX 3060, 12288, 581.57")),
    ]) {
      expect(plano.explicacao).not.toContain("—");
    }
  });

  it("com a placa, o motor ocupa mais disco", () => {
    const cuda = planejarMotor(lerNvidiaSmi("NVIDIA GeForce RTX 3060, 12288, 581.57"));
    expect(espacoNecessario(cuda)).toBeGreaterThan(espacoNecessario(planejarMotor([])));
  });

  it("o espaço exigido cobre o que a instalação ocupou de verdade", () => {
    // Medido em 01/10/2026 com uma RTX 3060: cache do uv 4,9 GB, modelos
    // 2,9 GB, programa 0,4 GB, Python 0,1 GB. A primeira versão pedia menos
    // do que ocupava — um disco quase cheio passaria na conferência e
    // encheria no meio da instalação.
    const medido = 8.3 * 1024 ** 3;
    const cuda = planejarMotor(lerNvidiaSmi("NVIDIA GeForce RTX 3060, 12288, 581.57"));
    expect(espacoNecessario(cuda)).toBeGreaterThan(medido);
  });
});

describe("o Docker liga, o ajudante pausa", () => {
  const rodando: Vigia = { modo: "rodando", contrarias: 0 };

  it("uma observação só não muda nada; duas seguidas mudam", () => {
    const uma = observar(rodando, true);
    expect(uma).toEqual({ modo: "rodando", contrarias: 1 });
    expect(observar(uma, true)).toEqual({ modo: "pausado", contrarias: 0 });
  });

  it("um Docker reiniciando não faz o motor ligar e desligar", () => {
    const uma = observar(rodando, true);
    expect(observar(uma, false)).toEqual({ modo: "rodando", contrarias: 0 });
  });

  it("o Docker desligou: o ajudante volta", () => {
    const pausado: Vigia = { modo: "pausado", contrarias: 0 };
    expect(observar(observar(pausado, false), false).modo).toBe("rodando");
  });

  it("só pausa pelo NOSSO motor na porta, não por qualquer serviço", () => {
    expect(ehNossoMotor({ status: "ok", engine: "local", model: "large-v3" })).toBe(
      true,
    );
    expect(ehNossoMotor({ status: "ok" })).toBe(false);
    expect(ehNossoMotor("<html>")).toBe(false);
  });
});

describe("a barra de progresso", () => {
  it("vai de 0 a 100 pelas etapas, na ordem", () => {
    expect(percentual("conferir", 0)).toBe(0);
    expect(percentual("concluir", 1)).toBe(100);
    expect(percentual("motor", 0)).toBeLessThan(percentual("motor", 0.5));
    expect(percentual("motor", 1)).toBe(percentual("modelos", 0));
  });

  it("baixar motor e modelos é quase toda a espera", () => {
    const pesado = ETAPAS.filter((e) => e.id === "motor" || e.id === "modelos");
    const total = ETAPAS.reduce((s, e) => s + e.peso, 0);
    expect(pesado.reduce((s, e) => s + e.peso, 0) / total).toBeGreaterThan(0.8);
  });

  it("tamanhos como a pessoa lê", () => {
    expect(tamanhoLegivel(1.2 * 1024 ** 3)).toBe("1,2 GB");
    expect(tamanhoLegivel(350 * 1024 * 1024)).toBe("350 MB");
    expect(tamanhoLegivel(412 * 1024 ** 3)).toBe("412 GB");
  });
});
