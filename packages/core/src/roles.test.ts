import { describe, expect, it } from "vitest";

import {
  identifyRolesByContent,
  MIN_CONFIDENCE,
  roleByLabel,
  swapRoles,
  type SpeakerInput,
} from "./roles";

function fala(speakerLabel: string, text: string): SpeakerInput {
  return { speakerLabel, text };
}

/** Uma consulta curta, com os sinais que aparecem de verdade. */
const CONSULTA: SpeakerInput[] = [
  fala("A", "Bom dia. O que te trouxe aqui hoje?"),
  fala("B", "Doutor, eu estou com uma dor nas costas."),
  fala("A", "Há quanto tempo a senhora sente isso?"),
  fala("B", "Faz uns três dias. Dói mais de manhã."),
  fala("A", "A senhora tomou alguma medicação?"),
  fala("B", "Tomei dipirona, mas não melhorou."),
  fala("A", "Vou pedir um relaxante muscular e quero rever a senhora em duas semanas."),
];

describe("identifyRolesByContent", () => {
  it("identifica o profissional numa consulta típica", () => {
    const r = identifyRolesByContent(CONSULTA);
    const mapa = roleByLabel(r);
    expect(mapa["A"]).toBe("professional");
    expect(mapa["B"]).toBe("patient");
  });

  // A ordem dos rótulos vem da diarização e é arbitrária: SPEAKER_00 tanto
  // pode ser o médico quanto o paciente. Se o resultado mudasse ao inverter,
  // estaríamos lendo a ordem em vez do conteúdo.
  it("não depende de qual rótulo a diarização deu", () => {
    const invertido = CONSULTA.map((s) =>
      fala(s.speakerLabel === "A" ? "B" : "A", s.text),
    );
    const mapa = roleByLabel(identifyRolesByContent(invertido));
    expect(mapa["B"]).toBe("professional");
    expect(mapa["A"]).toBe("patient");
  });

  it("chamar de doutor é sinal forte de paciente", () => {
    const mapa = roleByLabel(
      identifyRolesByContent([
        fala("X", "Então, vamos ver."),
        fala("Y", "Doutor, o senhor acha que é grave? Doutor, me diga."),
      ]),
    );
    expect(mapa["Y"]).toBe("patient");
    expect(mapa["X"]).toBe("professional");
  });

  it("anunciar conduta é sinal forte de profissional", () => {
    const mapa = roleByLabel(
      identifyRolesByContent([
        fala("X", "Vou solicitar um hemograma e vou prescrever o remédio."),
        fala("Y", "Tá bom."),
      ]),
    );
    expect(mapa["X"]).toBe("professional");
  });

  it("quem fala mais NÃO vira profissional por volume", () => {
    // O paciente desabafa longamente; o profissional fala pouco e conduz.
    const desabafo: SpeakerInput[] = [
      fala("MED", "Há quanto tempo?"),
      ...Array.from({ length: 20 }, () =>
        fala("PAC", "Doutor, eu tô sentindo muita dor, faz dias que dói."),
      ),
    ];
    const mapa = roleByLabel(identifyRolesByContent(desabafo));
    expect(mapa["MED"]).toBe("professional");
    expect(mapa["PAC"]).toBe("patient");
  });

  it("marca unknown quando o conteúdo não distingue", () => {
    const r = identifyRolesByContent([
      fala("A", "Sim."),
      fala("B", "Certo."),
      fala("A", "Entendi."),
      fala("B", "Tá bom."),
    ]);
    expect(r.every((x) => x.role === "unknown")).toBe(true);
    expect(r[0]?.confidence).toBeLessThan(MIN_CONFIDENCE);
  });

  it("acompanhante vira `other`, não um segundo paciente", () => {
    const mapa = roleByLabel(
      identifyRolesByContent([
        fala("MED", "O que te trouxe aqui? Há quanto tempo? Vou pedir um exame."),
        fala("PAC", "Doutor, eu tô com dor, dói muito, eu sinto isso faz dias."),
        fala("ACOMP", "Ela não quis vir antes."),
      ]),
    );
    expect(mapa["MED"]).toBe("professional");
    expect(mapa["PAC"]).toBe("patient");
    expect(mapa["ACOMP"]).toBe("other");
  });

  it("devolve lista vazia sem trechos", () => {
    expect(identifyRolesByContent([])).toEqual([]);
  });

  it("entrega evidência do que foi encontrado", () => {
    const r = identifyRolesByContent(CONSULTA);
    const medico = r.find((x) => x.role === "professional");
    expect(medico?.evidence.length).toBeGreaterThan(0);
    // Evidência tem que ser legível e apontar para o texto, como as citações.
    expect(medico?.evidence[0]?.signal).toBeTruthy();
    expect(medico?.evidence[0]?.excerpt).toBeTruthy();
  });

  it("não repete o mesmo tipo de evidência", () => {
    const r = identifyRolesByContent([
      fala("A", "Doutor, uma coisa."),
      fala("A", "Doutor, outra coisa."),
      fala("A", "Doutor, mais uma."),
      fala("B", "Vou pedir um exame."),
    ]);
    const paciente = r.find((x) => x.speakerLabel === "A");
    const tipos = paciente?.evidence.map((e) => e.signal) ?? [];
    expect(new Set(tipos).size).toBe(tipos.length);
  });
});

describe("swapRoles", () => {
  it("troca profissional e paciente", () => {
    const mapa = roleByLabel(swapRoles(identifyRolesByContent(CONSULTA)));
    expect(mapa["A"]).toBe("patient");
    expect(mapa["B"]).toBe("professional");
  });

  it("correção humana zera a dúvida", () => {
    const trocado = swapRoles(identifyRolesByContent(CONSULTA));
    expect(trocado.every((a) => a.confidence === 1)).toBe(true);
  });

  it("não mexe em `other` nem em `unknown`", () => {
    const original = identifyRolesByContent([fala("A", "Sim."), fala("B", "Certo.")]);
    expect(swapRoles(original).every((a) => a.role === "unknown")).toBe(true);
  });

  it("trocar duas vezes volta ao original", () => {
    const uma = identifyRolesByContent(CONSULTA);
    const duas = swapRoles(swapRoles(uma));
    expect(roleByLabel(duas)).toEqual(roleByLabel(uma));
  });
});
