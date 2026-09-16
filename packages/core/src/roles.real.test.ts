/**
 * Validação contra a transcrição REAL de uma consulta.
 *
 * Trechos colhidos da consulta médica simulada de 11,4 min (dois de máscara,
 * microfone de celular, murmúrio de sala de aula) que expôs os limites da
 * diarização. Os rótulos SPEAKER_00/01 são os que o pyannote produziu — com os
 * erros dele preservados de propósito.
 *
 * É o teste que diz se a identificação por conteúdo faz o que se espera dela:
 * acertar o papel APESAR da acústica ter errado as fronteiras.
 */

import { describe, expect, it } from "vitest";

import {
  identifyRolesByContent,
  refineRolesByVoice,
  roleByLabel,
  type SpeakerInput,
} from "./roles";

/** Amostra fiel da transcrição real, com os rótulos originais do pyannote. */
const CONSULTA_REAL: SpeakerInput[] = [
  { speakerLabel: "SPEAKER_00", text: "Bom," },
  { speakerLabel: "SPEAKER_01", text: "boa tarde, tudo bem?" },
  { speakerLabel: "SPEAKER_01", text: "Tudo bem." },
  { speakerLabel: "SPEAKER_01", text: "Fica à vontade." },
  { speakerLabel: "SPEAKER_01", text: "Por favor, deixa eu sentar aqui." },
  { speakerLabel: "SPEAKER_01", text: "Vou fazer uma coisa." },
  { speakerLabel: "SPEAKER_00", text: "Você começa, você começa." },
  { speakerLabel: "SPEAKER_01", text: "Olá, muito prazer." },
  { speakerLabel: "SPEAKER_01", text: "Me chamo Gabriel." },
  { speakerLabel: "SPEAKER_00", text: "Tenho 30 anos." },
  { speakerLabel: "SPEAKER_00", text: "Sou médico já formado há 5 anos." },
  { speakerLabel: "SPEAKER_00", text: "Sou especialista em quinta médica." },
  { speakerLabel: "SPEAKER_00", text: "E... qual o seu nome?" },
  { speakerLabel: "SPEAKER_00", text: "Meu nome é Patrícia." },
  { speakerLabel: "SPEAKER_00", text: "Muito prazer, Patrícia." },
  { speakerLabel: "SPEAKER_00", text: "Então, Patrícia, queria perguntar pra você." },
  { speakerLabel: "SPEAKER_00", text: "O que te trouxe aqui hoje?" },
  { speakerLabel: "SPEAKER_00", text: "Doutor Gabriel, eu tô seguindo." },
  {
    speakerLabel: "SPEAKER_00",
    text: "Há duas horas atrás, eu tava saindo de churrasco com minha filha mais velha.",
  },
  { speakerLabel: "SPEAKER_01", text: "Quando veio, começou a azar aqui no peito." },
  { speakerLabel: "SPEAKER_01", text: "Fiquei, nesse sentido, nauseada." },
  { speakerLabel: "SPEAKER_00", text: "Há quanto tempo a senhora sente isso?" },
  { speakerLabel: "SPEAKER_01", text: "Faz umas duas horas, doutor." },
  { speakerLabel: "SPEAKER_00", text: "A senhora toma alguma medicação em casa?" },
  { speakerLabel: "SPEAKER_01", text: "Tomei um remédio pra pressão de manhã." },
  { speakerLabel: "SPEAKER_00", text: "Já teve algum caso na família?" },
  { speakerLabel: "SPEAKER_01", text: "Meu pai teve infarto, doutor." },
  { speakerLabel: "SPEAKER_00", text: "Vou pedir um eletrocardiograma agora." },
  { speakerLabel: "SPEAKER_00", text: "Vou solicitar exames de sangue também." },
  {
    speakerLabel: "SPEAKER_01",
    text: "Doutor, e eu tô preocupada se realmente é grave.",
  },
];

describe("consulta real — identificação apesar da diarização errada", () => {
  it("identifica o profissional corretamente", () => {
    const mapa = roleByLabel(identifyRolesByContent(CONSULTA_REAL));
    expect(mapa["SPEAKER_00"]).toBe("professional");
    expect(mapa["SPEAKER_01"]).toBe("patient");
  });

  it("decide com confiança, não no limite", () => {
    const r = identifyRolesByContent(CONSULTA_REAL);
    // Se ficasse raspando o limiar, qualquer variação de áudio viraria
    // "unknown" e a promessa do Marco 3 não se sustentaria.
    expect(r[0]?.confidence).toBeGreaterThan(0.5);
  });

  it("mostra a evidência que sustenta a decisão", () => {
    const r = identifyRolesByContent(CONSULTA_REAL);
    const medico = r.find((x) => x.role === "professional");
    const sinais = medico?.evidence.map((e) => e.signal) ?? [];
    // A conduta anunciada é o sinal mais forte de todos.
    expect(sinais.length).toBeGreaterThan(1);
  });

  /**
   * O caso central: a acústica errou e o conteúdo tem que vencer.
   *
   * "Doutor Gabriel, eu tô seguindo" é fala da PACIENTE, mas o pyannote a
   * rotulou como SPEAKER_00 — o mesmo rótulo do médico. Ainda assim, o balanço
   * de sinais do conjunto põe SPEAKER_00 como profissional, porque é ele quem
   * anuncia conduta, pergunta duração e declara profissão.
   *
   * É exatamente o que a §7 da documentação prevê ao recomendar combinar
   * impressão vocal com classificação por conteúdo.
   */
  it("acerta mesmo com falas trocadas pela diarização", () => {
    const mapa = roleByLabel(identifyRolesByContent(CONSULTA_REAL));
    expect(mapa["SPEAKER_00"]).toBe("professional");
  });
});

describe("rótulos contaminados — não decidir é melhor que decidir errado", () => {
  /**
   * O caso que quebrou a primeira versão desta função.
   *
   * Quando a diarização mistura as pessoas, CADA rótulo passa a conter fala
   * dos dois, e nenhuma agregação por rótulo pode estar certa. A primeira
   * versão somava tudo num saldo líquido, encontrava uma pequena vantagem de
   * um lado, e devolvia o papel invertido com 100% de confiança.
   *
   * Confiança alta numa resposta errada é o pior resultado possível aqui: a
   * nota sairia com a queixa atribuída ao profissional e a conduta ao
   * paciente, com aparência de correção. "Não consegui identificar" é um
   * resultado ruim; invertido com certeza é um resultado perigoso.
   */
  const CONTAMINADO: SpeakerInput[] = [
    // Ambos os rótulos com sinais fortes DOS DOIS papéis
    { speakerLabel: "A", text: "Sou médico há 5 anos. O que te trouxe aqui?" },
    { speakerLabel: "A", text: "Doutor, eu tô com dor no peito, dói muito." },
    { speakerLabel: "A", text: "Vou pedir um eletrocardiograma." },
    { speakerLabel: "A", text: "Tomei um remédio pra pressão, doutor." },
    { speakerLabel: "B", text: "Há quanto tempo a senhora sente isso?" },
    { speakerLabel: "B", text: "Doutor, faz duas horas, eu tô preocupada." },
    { speakerLabel: "B", text: "Vou solicitar exames de sangue." },
    { speakerLabel: "B", text: "Eu sinto uma pressão aqui, doutor." },
  ];

  it("recusa decidir quando os dois rótulos têm sinais dos dois papéis", () => {
    const r = identifyRolesByContent(CONTAMINADO);
    expect(r.every((a) => a.role === "unknown")).toBe(true);
  });

  it("e a confiança reflete isso, em vez de mentir", () => {
    const r = identifyRolesByContent(CONTAMINADO);
    expect(r[0]?.confidence).toBeLessThan(0.3);
  });

  it("mas continua decidindo quando os rótulos são limpos", () => {
    const limpo: SpeakerInput[] = [
      { speakerLabel: "A", text: "Sou médico. O que te trouxe aqui hoje?" },
      { speakerLabel: "A", text: "Há quanto tempo? Vou pedir um exame." },
      { speakerLabel: "B", text: "Doutor, eu tô com dor, dói muito." },
      { speakerLabel: "B", text: "Tomei um remédio, doutor, mas não melhorou." },
    ];
    const mapa = roleByLabel(identifyRolesByContent(limpo));
    expect(mapa["A"]).toBe("professional");
    expect(mapa["B"]).toBe("patient");
  });
});

describe("impressão vocal — só corrige onde o sinal é forte", () => {
  /**
   * Medido em consulta real com máscara e microfone de celular: as duas vozes
   * ficaram a 0,17 de distância, com faixas sobrepostas. Corrigir trecho a
   * trecho nesse regime é sorteio — 35 de 139 trechos "discordavam", com
   * acertos e erros misturados.
   */
  const RUIDOSO = [
    { speakerLabel: "A", voiceSimilarity: 0.58 },
    { speakerLabel: "A", voiceSimilarity: 0.42 },
    { speakerLabel: "B", voiceSimilarity: 0.45 },
    { speakerLabel: "B", voiceSimilarity: 0.38 },
  ];

  const LIMPO = [
    { speakerLabel: "A", voiceSimilarity: 0.88 },
    { speakerLabel: "A", voiceSimilarity: 0.82 },
    { speakerLabel: "B", voiceSimilarity: 0.21 },
    { speakerLabel: "B", voiceSimilarity: 0.17 },
  ];

  const PAPEIS = [
    { speakerLabel: "A", role: "professional" as const, confidence: 0.8, evidence: [] },
    { speakerLabel: "B", role: "patient" as const, confidence: 0.8, evidence: [] },
  ];

  it("não mexe em trecho algum quando as vozes estão próximas", () => {
    const r = refineRolesByVoice(PAPEIS, RUIDOSO);
    expect(r.correctedIndexes).toEqual([]);
  });

  it("mas ainda confirma quem é quem", () => {
    const r = refineRolesByVoice(PAPEIS, RUIDOSO);
    expect(roleByLabel(r.assignments)["A"]).toBe("professional");
    expect(r.disagreed).toBe(false);
  });

  it("com vozes bem separadas, a correção volta a valer", () => {
    const comErro = [...LIMPO, { speakerLabel: "B", voiceSimilarity: 0.85 }];
    const r = refineRolesByVoice(PAPEIS, comErro);
    // O último trecho tem rótulo do paciente e voz de médico: é o caso que
    // justifica o Método A existir.
    expect(r.correctedIndexes).toContain(4);
  });

  it("sinaliza quando a voz discorda do conteúdo", () => {
    const invertido = [
      { speakerLabel: "A", role: "patient" as const, confidence: 0.8, evidence: [] },
      {
        speakerLabel: "B",
        role: "professional" as const,
        confidence: 0.8,
        evidence: [],
      },
    ];
    expect(refineRolesByVoice(invertido, LIMPO).disagreed).toBe(true);
  });

  it("sem medida nenhuma, devolve tudo intacto", () => {
    const r = refineRolesByVoice(PAPEIS, [{ speakerLabel: "A" }]);
    expect(r.assignments).toBe(PAPEIS);
    expect(r.correctedIndexes).toEqual([]);
  });
});
