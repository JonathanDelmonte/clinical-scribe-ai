import { describe, expect, it } from "vitest";

import {
  atribuicaoDosCanais,
  falantePorSobreposicao,
  lerEstadoDoSegundoMicrofone,
  papeisDosCanais,
  reatribuirPorCanais,
  ROTULO_PRINCIPAL,
  ROTULO_SEGUNDO,
  type TrechoParaReatribuir,
  type TurnoDeCanal,
} from "./channels";
import type { SpeakerAssignment } from "./roles";

const TURNOS: TurnoDeCanal[] = [
  { inicioS: 0, fimS: 4, falante: ROTULO_PRINCIPAL },
  { inicioS: 4, fimS: 9, falante: ROTULO_SEGUNDO },
  { inicioS: 9, fimS: 12, falante: ROTULO_PRINCIPAL },
];

function trecho(
  id: string,
  startMs: number,
  endMs: number,
  extra: Partial<TrechoParaReatribuir> = {},
): TrechoParaReatribuir {
  return {
    id,
    speakerLabel: "SPEAKER_07",
    role: "patient",
    roleSource: "llm",
    correctedAt: null,
    startMs,
    endMs,
    ...extra,
  };
}

describe("falantePorSobreposicao", () => {
  it("escolhe o turno que cobre o trecho", () => {
    expect(falantePorSobreposicao(5000, 8000, TURNOS)).toBe(ROTULO_SEGUNDO);
  });

  // O trecho começa com a cauda da fala anterior. Decidir pelo primeiro
  // instante daria a primeira sílaba de cada resposta a quem perguntou.
  it("decide pela maior sobreposição, não pelo início", () => {
    expect(falantePorSobreposicao(3500, 8500, TURNOS)).toBe(ROTULO_SEGUNDO);
  });

  it("devolve null quando nenhum turno toca o trecho", () => {
    expect(falantePorSobreposicao(20_000, 21_000, TURNOS)).toBeNull();
  });
});

describe("papeisDosCanais", () => {
  it("segundo microfone perto do paciente: o aparelho principal é o profissional", () => {
    expect(papeisDosCanais("patient")).toEqual({
      [ROTULO_PRINCIPAL]: "professional",
      [ROTULO_SEGUNDO]: "patient",
    });
  });

  it("segundo microfone perto do profissional: o contrário", () => {
    expect(papeisDosCanais("professional")).toEqual({
      [ROTULO_PRINCIPAL]: "patient",
      [ROTULO_SEGUNDO]: "professional",
    });
  });
});

describe("reatribuirPorCanais", () => {
  it("mantém o id de cada trecho — as citações da nota continuam valendo", () => {
    const r = reatribuirPorCanais(
      [trecho("a", 0, 3000), trecho("b", 5000, 8000)],
      TURNOS,
      "patient",
    );
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r.map((x) => x.speakerLabel)).toEqual([ROTULO_PRINCIPAL, ROTULO_SEGUNDO]);
  });

  it("dá o papel pela posição declarada, e marca a origem como canal", () => {
    const [a, b] = reatribuirPorCanais(
      [trecho("a", 0, 3000), trecho("b", 5000, 8000, { role: "professional" })],
      TURNOS,
      "patient",
    );
    expect(a).toMatchObject({
      role: "professional",
      roleSource: "channel",
      origem: "medido",
    });
    expect(b).toMatchObject({
      role: "patient",
      roleSource: "channel",
      origem: "medido",
    });
  });

  it("a posição inverte os papéis", () => {
    const [a] = reatribuirPorCanais([trecho("a", 0, 3000)], TURNOS, "professional");
    expect(a?.role).toBe("patient");
  });

  // A regra sem exceção. Se o algoritmo e a pessoa discordam, quem sabe é quem
  // estava na sala.
  it("não mexe no papel de trecho corrigido à mão", () => {
    const [manual] = reatribuirPorCanais(
      [
        trecho("m", 5000, 8000, {
          role: "professional",
          roleSource: "manual",
          correctedAt: new Date("2026-09-20T10:00:00Z"),
        }),
      ],
      TURNOS,
      "patient",
    );
    expect(manual).toMatchObject({
      role: "professional",
      roleSource: "manual",
      origem: "preservado",
      // O rótulo acústico muda; o papel é que fica.
      speakerLabel: ROTULO_SEGUNDO,
    });
  });

  // "Trocar" grava `manual` em TODOS os trechos, sem data de correção. É uma
  // correção da diarização antiga, não uma afirmação sobre cada fala — e se
  // ela congelasse os papéis, o segundo microfone não consertaria nada
  // justamente onde a separação por voz mais errou.
  it("a inversão de papéis NÃO congela os trechos", () => {
    const [invertido] = reatribuirPorCanais(
      [trecho("i", 5000, 8000, { role: "professional", roleSource: "manual" })],
      TURNOS,
      "patient",
    );
    expect(invertido).toMatchObject({ role: "patient", origem: "medido" });
  });

  it("correção só de texto não congela o papel", () => {
    const [texto] = reatribuirPorCanais(
      [trecho("t", 0, 3000, { correctedAt: "2026-09-20T10:00:00Z" })],
      TURNOS,
      "patient",
    );
    expect(texto).toMatchObject({ role: "professional", origem: "medido" });
  });

  // O segundo aparelho começou depois, ou ninguém falou alto o bastante ali.
  it("trecho sem medida mantém o papel e ganha o rótulo do lado desse papel", () => {
    const [semMedida] = reatribuirPorCanais(
      [trecho("s", 20_000, 22_000, { role: "patient", roleSource: "voice_match" })],
      TURNOS,
      "patient",
    );
    expect(semMedida).toEqual({
      id: "s",
      speakerLabel: ROTULO_SEGUNDO,
      role: "patient",
      roleSource: "voice_match",
      origem: "sem_medida",
    });
  });

  it("trecho sem medida e sem papel conhecido fica com o rótulo antigo", () => {
    const [s] = reatribuirPorCanais(
      [trecho("s", 20_000, 22_000, { role: "unknown" })],
      TURNOS,
      "patient",
    );
    expect(s?.speakerLabel).toBe("SPEAKER_07");
  });
});

describe("atribuicaoDosCanais", () => {
  function conteudo(
    profissional: string | null,
    confianca: number,
  ): SpeakerAssignment[] {
    return [ROTULO_PRINCIPAL, ROTULO_SEGUNDO].map((rotulo) => ({
      speakerLabel: rotulo,
      role:
        profissional === null
          ? ("unknown" as const)
          : rotulo === profissional
            ? ("professional" as const)
            : ("patient" as const),
      confidence: confianca,
      evidence: [{ signal: `sinal de ${rotulo}`, excerpt: "…", weight: 1 }],
    }));
  }

  it("o papel vem da posição, com as evidências do conteúdo para a tela", () => {
    const { atribuicao, conteudoDiscorda } = atribuicaoDosCanais(
      "patient",
      conteudo(ROTULO_PRINCIPAL, 0.9),
    );
    expect(conteudoDiscorda).toBe(false);
    expect(atribuicao).toEqual([
      {
        speakerLabel: ROTULO_PRINCIPAL,
        role: "professional",
        confidence: 1,
        evidence: [{ signal: `sinal de ${ROTULO_PRINCIPAL}`, excerpt: "…", weight: 1 }],
      },
      {
        speakerLabel: ROTULO_SEGUNDO,
        role: "patient",
        confidence: 1,
        evidence: [{ signal: `sinal de ${ROTULO_SEGUNDO}`, excerpt: "…", weight: 1 }],
      },
    ]);
  });

  it("conteúdo sem opinião não derruba a confiança", () => {
    const { atribuicao, conteudoDiscorda } = atribuicaoDosCanais(
      "patient",
      conteudo(null, 0.1),
    );
    expect(conteudoDiscorda).toBe(false);
    expect(atribuicao.every((a) => a.confidence === 1)).toBe(true);
  });

  // Esquecer onde o celular ficou é um erro plausível. O resultado seria a
  // transcrição inteira com os papéis trocados — então a confiança cai e a
  // tela pede revisão, sem que o sistema passe por cima do que foi declarado.
  it("conteúdo que discorda com segurança derruba a confiança, sem trocar o papel", () => {
    const { atribuicao, conteudoDiscorda } = atribuicaoDosCanais(
      "patient",
      conteudo(ROTULO_SEGUNDO, 0.8),
    );
    expect(conteudoDiscorda).toBe(true);
    expect(atribuicao.map((a) => a.role)).toEqual(["professional", "patient"]);
    expect(atribuicao[0]?.confidence).toBeCloseTo(0.2);
  });
});

describe("lerEstadoDoSegundoMicrofone", () => {
  const valido = {
    estado: "na_fila",
    segundoPerto: "patient",
    enviadoEm: "2026-09-23T12:00:00Z",
    duracaoS: 600,
  };

  it("aceita o que a rota grava", () => {
    expect(lerEstadoDoSegundoMicrofone(valido)).toEqual(valido);
  });

  // O worker decide o papel de cada fala por `segundoPerto`. Um valor que ele
  // não reconhece não pode virar um papel por omissão.
  it("recusa lado desconhecido, estado desconhecido e forma quebrada", () => {
    expect(
      lerEstadoDoSegundoMicrofone({ ...valido, segundoPerto: "paciente" }),
    ).toBeNull();
    expect(lerEstadoDoSegundoMicrofone({ ...valido, estado: "pronto" })).toBeNull();
    expect(lerEstadoDoSegundoMicrofone({ ...valido, duracaoS: "600" })).toBeNull();
    expect(lerEstadoDoSegundoMicrofone(null)).toBeNull();
    expect(lerEstadoDoSegundoMicrofone("na_fila")).toBeNull();
  });
});
