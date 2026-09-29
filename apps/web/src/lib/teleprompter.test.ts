import { describe, expect, it } from "vitest";

import {
  adiantarRitmo,
  CONFERENCIA_INICIAL,
  conferir,
  DetectorDeVoz,
  duracaoEsperadaMs,
  FRACAO_RECONHECIDA,
  fraseDoCursor,
  montarRoteiro,
  nomeParaLeitura,
  palavrasDe,
  palavrasLidas,
  parecida,
  passoDoRitmo,
  QUADRO_MS,
  resultadoDaFrase,
  RITMO_INICIAL,
  roteiroDeVoz,
  type Ritmo,
} from "./teleprompter";

describe("o roteiro", () => {
  it("apresenta a pessoa pelo nome e pela área, sem título", () => {
    const [primeira] = roteiroDeVoz({
      nome: "Dra. Ana Ribeiro",
      especialidade: "nutrição",
    });
    expect(primeira).toBe("Meu nome é Ana Ribeiro e eu trabalho com nutrição.");
  });

  it("não inventa área quando não há uma", () => {
    expect(roteiroDeVoz({ nome: "Bruno Lima", especialidade: null })[0]).toBe(
      "Meu nome é Bruno Lima.",
    );
    expect(roteiroDeVoz({ nome: "Bruno Lima", especialidade: "outra" })[0]).toBe(
      "Meu nome é Bruno Lima.",
    );
  });

  it("tem uma apresentação neutra sem nome", () => {
    expect(roteiroDeVoz({})[0]).toBe("Olá, esta é a minha voz.");
  });

  it("mantém as quatro frases de consulta depois da apresentação", () => {
    expect(roteiroDeVoz({ nome: "Ana" })).toHaveLength(5);
  });

  it("tira títulos e comentários do nome", () => {
    expect(nomeParaLeitura("Prof. Carlos (exemplo) Souza")).toBe("Carlos Souza");
    expect(nomeParaLeitura("Dr Paulo")).toBe("Paulo");
  });

  it("guarda o texto da tela e a chave de comparação de cada palavra", () => {
    const r = montarRoteiro(["Bom dia, boa tarde.", "Fique à vontade."]);
    expect(r.palavras.map((p) => p.texto)).toEqual([
      "Bom",
      "dia,",
      "boa",
      "tarde.",
      "Fique",
      "à",
      "vontade.",
    ]);
    expect(r.palavras.map((p) => p.chave)).toEqual([
      "bom",
      "dia",
      "boa",
      "tarde",
      "fique",
      "a",
      "vontade",
    ]);
    expect(r.inicioDaFrase).toEqual([0, 4]);
  });
});

describe("comparar palavras", () => {
  it("ignora acento, maiúscula e pontuação", () => {
    expect(palavrasDe("Há quanto tempo? Você.")).toEqual([
      "ha",
      "quanto",
      "tempo",
      "voce",
    ]);
  });

  it("aceita número escrito em algarismo", () => {
    expect(parecida("2", "duas")).toBe(true);
    expect(parecida("dois", "2")).toBe(true);
  });

  it("perdoa plural e terminação que o modelo come", () => {
    expect(parecida("consulta", "consultas")).toBe(true);
    expect(parecida("reconhece", "reconhecer")).toBe(true);
    expect(parecida("amosta", "amostra")).toBe(true);
  });

  it("não confunde palavras curtas parecidas", () => {
    expect(parecida("bom", "boa")).toBe(false);
    expect(parecida("e", "o")).toBe(false);
  });

  it("não aceita palavras diferentes de verdade", () => {
    expect(parecida("tarde", "noite")).toBe(false);
    expect(parecida("exames", "semanas")).toBe(false);
  });
});

describe("conferir o que foi ouvido", () => {
  const roteiro = montarRoteiro(
    roteiroDeVoz({ nome: "Ana Ribeiro", especialidade: "nutrição" }),
  );

  it("marca as palavras ouvidas e anda o cursor", () => {
    const c = conferir(
      roteiro,
      CONFERENCIA_INICIAL,
      "Meu nome é Ana Ribeiro e eu trabalho com nutrição.",
    );
    const r = resultadoDaFrase(roteiro, c, 0);
    expect(r.fracao).toBe(1);
    expect(fraseDoCursor(roteiro, c)).toBe(1);
  });

  it("dá conta de palavra engolida e de palavra inventada", () => {
    const c = conferir(
      roteiro,
      CONFERENCIA_INICIAL,
      "meu nome é Ana e eu trabalho com nutrição obrigado",
    );
    const r = resultadoDaFrase(roteiro, c, 0);
    // "ribeiro" faltou; "obrigado" não tem par e não conta.
    expect(r.acertos).toBe(r.total - 1);
    expect(r.fracao).toBeGreaterThanOrEqual(FRACAO_RECONHECIDA);
  });

  it("frase lida errada fica abaixo do limite", () => {
    const c = conferir(roteiro, CONFERENCIA_INICIAL, "o tempo está bom hoje");
    expect(resultadoDaFrase(roteiro, c, 0).fracao).toBeLessThan(FRACAO_RECONHECIDA);
  });

  it("junta trechos: uma frase cortada na vírgula ainda fecha", () => {
    let c = conferir(
      roteiro,
      CONFERENCIA_INICIAL,
      "Meu nome é Ana Ribeiro e eu trabalho com nutrição.",
    );
    c = conferir(roteiro, c, "Esta é uma amostra da minha voz,");
    c = conferir(roteiro, c, "para o sistema me reconhecer nas consultas.");
    expect(resultadoDaFrase(roteiro, c, 1).fracao).toBe(1);
  });

  it("com a dica, recupera depois de uma frase perdida inteira", () => {
    const c0 = conferir(
      roteiro,
      CONFERENCIA_INICIAL,
      "Meu nome é Ana Ribeiro e eu trabalho com nutrição.",
    );
    // A frase 1 (a longa) não foi reconhecida. Vem a frase 2.
    const inicioDa2 = roteiro.inicioDaFrase[2] ?? 0;
    const semDica = conferir(
      roteiro,
      c0,
      "Bom dia, boa tarde, boa noite. Fique à vontade.",
    );
    const comDica = conferir(
      roteiro,
      c0,
      "Bom dia, boa tarde, boa noite. Fique à vontade.",
      inicioDa2,
    );
    expect(resultadoDaFrase(roteiro, semDica, 2).fracao).toBeLessThan(
      FRACAO_RECONHECIDA,
    );
    expect(resultadoDaFrase(roteiro, comDica, 2).fracao).toBe(1);
  });

  it("releitura não volta o cursor", () => {
    let c = conferir(
      roteiro,
      CONFERENCIA_INICIAL,
      "Meu nome é Ana Ribeiro e eu trabalho com nutrição.",
    );
    const cursor = c.cursor;
    c = conferir(roteiro, c, "meu nome é Ana");
    expect(c.cursor).toBe(cursor);
  });

  it("aceita duas semanas escrito com algarismo", () => {
    const inicio = roteiro.inicioDaFrase[4] ?? 0;
    const c = conferir(
      roteiro,
      { ouvidas: new Set(), cursor: inicio },
      "Quero rever você em 2 semanas.",
    );
    expect(resultadoDaFrase(roteiro, c, 4).fracao).toBe(1);
  });
});

describe("o ritmo da leitura", () => {
  const esperado = 2000;

  function rodar(ritmo: Ritmo, voz: boolean, ms: number): Ritmo {
    let r = ritmo;
    for (let t = 0; t < ms; t += QUADRO_MS) r = passoDoRitmo(r, voz, esperado);
    return r;
  }

  it("estima a duração pelo tamanho da frase", () => {
    expect(duracaoEsperadaMs("Quero rever você em duas semanas.")).toBeGreaterThan(
      1500,
    );
    expect(duracaoEsperadaMs("Oi.")).toBe(900);
  });

  it("não conta um estalo como fala", () => {
    const r = passoDoRitmo(RITMO_INICIAL, true, esperado);
    expect(r.vozMs).toBe(0);
  });

  it("troca de frase na pausa depois de ler quase tudo", () => {
    let r = rodar(RITMO_INICIAL, true, 1800);
    expect(r.frase).toBe(0);
    r = rodar(r, false, 480);
    expect(r.frase).toBe(1);
  });

  it("não troca na pausa do meio da frase", () => {
    let r = rodar(RITMO_INICIAL, true, 900);
    r = rodar(r, false, 900);
    expect(r.frase).toBe(0);
  });

  it("troca com um fôlego curto quando a frase já passou muito do esperado", () => {
    let r = rodar(RITMO_INICIAL, true, 3000);
    expect(r.frase).toBe(0);
    r = rodar(r, false, 180);
    expect(r.frase).toBe(1);
  });

  it("troca mesmo sem pausa quando passa demais do esperado", () => {
    const r = rodar(RITMO_INICIAL, true, 4500);
    expect(r.frase).toBe(1);
  });

  it("a conferência só adianta, nunca volta", () => {
    const r = rodar(RITMO_INICIAL, true, 600);
    expect(adiantarRitmo(r, 2).frase).toBe(2);
    expect(adiantarRitmo({ ...r, frase: 3 }, 1).frase).toBe(3);
  });

  it("acende as palavras pelo tamanho", () => {
    const frase = "Há quanto tempo você sente isso?";
    expect(palavrasLidas(frase, 0)).toBe(0);
    expect(palavrasLidas(frase, 1)).toBe(6);
    expect(palavrasLidas(frase, 0.5)).toBeGreaterThanOrEqual(2);
    expect(palavrasLidas(frase, 0.5)).toBeLessThanOrEqual(4);
  });
});

describe("voz ou sala", () => {
  const quadro = (amplitude: number) => {
    const q = new Float32Array(480);
    for (let i = 0; i < q.length; i++) q[i] = Math.sin(i / 3) * amplitude;
    return q;
  };
  const energia = (amplitude: number) => {
    const q = quadro(amplitude);
    let soma = 0;
    for (const v of q) soma += v * v;
    return Math.sqrt(soma / q.length);
  };

  it("sala sozinha não é voz, nem no começo", () => {
    const d = new DetectorDeVoz();
    const respostas = Array.from({ length: 50 }, () => d.ouvir(energia(0.004)));
    expect(respostas.some(Boolean)).toBe(false);
  });

  it("depois da sala, a fala passa e a sala continua de fora", () => {
    const d = new DetectorDeVoz();
    for (let i = 0; i < 60; i++) d.ouvir(energia(0.003));
    for (let i = 0; i < 20; i++) d.ouvir(energia(0.08));
    expect(d.ouvir(energia(0.08))).toBe(true);
    expect(d.ouvir(energia(0.003))).toBe(false);
  });
});
