import { describe, expect, it } from "vitest";

import { Limitador } from "./rate-limit";

/** Relógio controlado: o teste não pode esperar quinze minutos. */
function relogio(inicio = 1_000_000) {
  let agora = inicio;
  return {
    ler: () => agora,
    avancar: (ms: number) => {
      agora += ms;
    },
  };
}

describe("limitador", () => {
  it("deixa passar até a capacidade", () => {
    const t = relogio();
    const l = new Limitador({ capacidade: 3, recargaMs: 60_000 }, t.ler);

    expect(l.consumir("a").permitido).toBe(true);
    expect(l.consumir("a").permitido).toBe(true);
    expect(l.consumir("a").permitido).toBe(true);
    expect(l.consumir("a").permitido).toBe(false);
  });

  it("conta cada chave separadamente", () => {
    const t = relogio();
    const l = new Limitador({ capacidade: 1, recargaMs: 60_000 }, t.ler);

    expect(l.consumir("ana").permitido).toBe(true);
    expect(l.consumir("ana").permitido).toBe(false);
    expect(l.consumir("bruno").permitido).toBe(true);
  });

  it("recarrega aos poucos, não de uma vez", () => {
    const t = relogio();
    const l = new Limitador({ capacidade: 4, recargaMs: 60_000 }, t.ler);

    for (let i = 0; i < 4; i++) l.consumir("a");
    expect(l.consumir("a").permitido).toBe(false);

    // Um quarto do tempo de recarga: exatamente uma ficha.
    t.avancar(15_000);
    expect(l.consumir("a").permitido).toBe(true);
    expect(l.consumir("a").permitido).toBe(false);
  });

  it("enche até a capacidade e não além", () => {
    const t = relogio();
    const l = new Limitador({ capacidade: 2, recargaMs: 1000 }, t.ler);

    l.consumir("a");
    l.consumir("a");
    t.avancar(60_000); // muito mais que o tempo de recarga

    expect(l.consumir("a").permitido).toBe(true);
    expect(l.consumir("a").permitido).toBe(true);
    expect(l.consumir("a").permitido).toBe(false);
  });

  /**
   * O defeito da janela fixa, que o balde não tem: com "2 por minuto" numa
   * janela, dá para fazer 2 no fim de um minuto e 2 no começo do seguinte —
   * 4 em dois segundos, que é justamente o que o limite deveria impedir.
   */
  it("não deixa dobrar o limite na virada da janela", () => {
    const t = relogio();
    const l = new Limitador({ capacidade: 2, recargaMs: 60_000 }, t.ler);

    l.consumir("a");
    l.consumir("a");
    t.avancar(1000); // "o minuto virou"

    expect(l.consumir("a").permitido).toBe(false);
  });

  /**
   * Quem insiste sem parar não pode empurrar o próprio desbloqueio para
   * frente. Se uma tentativa negada consumisse tempo, o atacante que tenta
   * dez vezes por segundo nunca sairia do bloqueio — e o usuário legítimo
   * atrás do mesmo IP também não.
   */
  it("tentativa negada não adia a recuperação", () => {
    const t = relogio();
    const l = new Limitador({ capacidade: 1, recargaMs: 10_000 }, t.ler);

    l.consumir("a");
    for (let i = 0; i < 50; i++) {
      t.avancar(100);
      l.consumir("a");
    }

    // Passaram-se 5 s dos 10 s. Ainda bloqueado, mas a meio caminho.
    expect(l.consumir("a").permitido).toBe(false);
    t.avancar(5100);
    expect(l.consumir("a").permitido).toBe(true);
  });

  it("diz quanto falta esperar", () => {
    const t = relogio();
    const l = new Limitador({ capacidade: 1, recargaMs: 10_000 }, t.ler);

    l.consumir("a");
    const negado = l.consumir("a");
    expect(negado.permitido).toBe(false);
    expect(negado.esperarSegundos).toBeGreaterThan(0);
    expect(negado.esperarSegundos).toBeLessThanOrEqual(10);
  });

  it("informa quantas fichas sobraram", () => {
    const t = relogio();
    const l = new Limitador({ capacidade: 3, recargaMs: 60_000 }, t.ler);

    expect(l.consumir("a").restantes).toBe(2);
    expect(l.consumir("a").restantes).toBe(1);
    expect(l.consumir("a").restantes).toBe(0);
  });
});

describe("limpeza", () => {
  /**
   * Sem limpeza, o mapa cresce com uma entrada por IP visto e nunca encolhe.
   * Um balde cheio não carrega informação: recriá-lo dá o mesmo resultado.
   */
  it("remove os baldes que já encheram de novo", () => {
    const t = relogio();
    const l = new Limitador({ capacidade: 2, recargaMs: 1000 }, t.ler);

    l.consumir("a");
    l.consumir("b");
    expect(l.tamanho).toBe(2);

    expect(l.limpar()).toBe(0); // ainda não encheram
    t.avancar(2000);
    expect(l.limpar()).toBe(2);
    expect(l.tamanho).toBe(0);
  });

  it("preserva quem ainda está em recuperação", () => {
    const t = relogio();
    const l = new Limitador({ capacidade: 2, recargaMs: 10_000 }, t.ler);

    l.consumir("bloqueado");
    l.consumir("bloqueado");
    l.consumir("quase");

    t.avancar(6000);
    l.limpar();

    // "quase" já recuperou a ficha e foi removido; "bloqueado" ainda não.
    expect(l.tamanho).toBe(1);
    expect(l.consumir("bloqueado").permitido).toBe(true);
    expect(l.consumir("bloqueado").permitido).toBe(false);
  });
});
