import { describe, expect, it } from "vitest";

import {
  dataPorExtenso,
  haQuanto,
  periodoDoDia,
  primeiroNome,
  resumoDoDia,
} from "./saudacao";

describe("há quanto tempo", () => {
  const agora = new Date("2026-09-29T11:00:00Z"); // 8h em Brasília

  it("conta dias do calendário, não blocos de 24 horas", () => {
    // 23h de ontem em Brasília: menos de 24 horas atrás, e mesmo assim ontem.
    expect(haQuanto(new Date("2026-09-29T02:00:00Z"), agora)).toBe("ontem");
    expect(haQuanto(new Date("2026-09-29T10:00:00Z"), agora)).toBe("hoje");
  });

  it("fala em dias e semanas", () => {
    expect(haQuanto(new Date("2026-09-26T15:00:00Z"), agora)).toBe("há 3 dias");
    expect(haQuanto(new Date("2026-09-20T15:00:00Z"), agora)).toBe("há 1 semana");
    expect(haQuanto(new Date("2026-09-12T15:00:00Z"), agora)).toBe("há 2 semanas");
  });

  it("dá a data quando passa de um mês", () => {
    expect(haQuanto(new Date("2026-06-18T15:00:00Z"), agora)).toBe("18 de jun");
  });
});

describe("período do dia", () => {
  // Datas em UTC; o fuso de Brasília fica três horas atrás.
  it("é manhã às 9h em Brasília", () => {
    expect(periodoDoDia(new Date("2026-09-29T12:00:00Z"))).toBe("manha");
  });

  it("é tarde às 15h", () => {
    expect(periodoDoDia(new Date("2026-09-29T18:00:00Z"))).toBe("tarde");
  });

  it("é noite às 21h e de madrugada", () => {
    expect(periodoDoDia(new Date("2026-09-30T00:00:00Z"))).toBe("noite");
    expect(periodoDoDia(new Date("2026-09-29T06:30:00Z"))).toBe("noite");
  });

  it("respeita outro fuso quando pedido", () => {
    // 11h em Brasília são 10h em Manaus: ainda manhã nos dois.
    expect(periodoDoDia(new Date("2026-09-29T14:00:00Z"), "America/Manaus")).toBe(
      "manha",
    );
  });
});

describe("data por extenso", () => {
  it("escreve o dia da semana com maiúscula", () => {
    expect(dataPorExtenso(new Date("2026-09-29T15:00:00Z"))).toBe(
      "Terça-feira, 29 de setembro",
    );
  });
});

describe("primeiro nome", () => {
  it("fica com o primeiro nome", () => {
    expect(primeiroNome("Ana Ribeiro")).toBe("Ana");
  });

  it("mantém o título que a pessoa escreveu", () => {
    expect(primeiroNome("Dra. Ana Ribeiro")).toBe("Dra. Ana");
    expect(primeiroNome("Dr João")).toBe("Dr João");
  });

  it("não quebra com nome vazio", () => {
    expect(primeiroNome("  ")).toBe("");
  });
});

describe("resumo do dia", () => {
  it("fala das notas por extenso", () => {
    expect(resumoDoDia(2, 0)).toBe(
      "Duas notas estão prontas para você revisar. O resto está em dia.",
    );
    expect(resumoDoDia(1, 0)).toBe(
      "Uma nota está pronta para você revisar. O resto está em dia.",
    );
  });

  it("junta o que ainda está sendo escrito", () => {
    expect(resumoDoDia(1, 2)).toBe(
      "Uma nota está pronta para você revisar. Duas consultas ainda estão sendo escritas.",
    );
    expect(resumoDoDia(0, 1)).toBe("Uma consulta ainda está sendo escrita.");
  });

  it("usa algarismos acima de dez", () => {
    expect(resumoDoDia(12, 0)).toBe(
      "12 notas estão prontas para você revisar. O resto está em dia.",
    );
  });

  it("diz quando está tudo em dia", () => {
    expect(resumoDoDia(0, 0)).toBe("Tudo em dia. Nenhuma nota esperando por você.");
  });
});
