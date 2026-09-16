/**
 * Identificação de papel — quem é o profissional, quem é o paciente.
 *
 * A diarização entrega `SPEAKER_00` e `SPEAKER_01`. Isto transforma esses
 * rótulos em PROFISSIONAL e PACIENTE, que é o que a nota clínica precisa.
 *
 * Duas decisões de projeto que governam o arquivo inteiro:
 *
 * **1. Rotula FALANTES, não trechos.** São dois ou três rótulos contra
 * centenas de trechos. Decidir por trecho seria caro, lento e instável — e um
 * trecho isolado ("Sim.", "Certo.") não carrega informação suficiente para
 * decidir nada. A pergunta certa é "qual destes falantes é o profissional?", e
 * ela se responde olhando o conjunto.
 *
 * **2. Conteúdo corrige acústica.** Medido num áudio real de consulta — os dois
 * de máscara, microfone de celular — o pyannote acerta quantas pessoas são e
 * erra onde ficam as fronteiras. Nenhum ajuste acústico conserta isso. Mas
 * "Sou médico já formado há 5 anos" identifica o falante independentemente do
 * rótulo que a acústica deu. Ver ADR-0002.
 */

import type { SpeakerRole } from "./domain";

export interface RoleEvidence {
  /** O que foi encontrado, em português, para mostrar ao profissional. */
  readonly signal: string;
  /** Trecho onde apareceu — a mesma disciplina das citações. */
  readonly excerpt: string;
  /** Positivo puxa para profissional, negativo para paciente. */
  readonly weight: number;
}

export interface SpeakerAssignment {
  readonly speakerLabel: string;
  readonly role: SpeakerRole;
  /** 0 a 1. Abaixo de `MIN_CONFIDENCE` o papel fica `unknown`. */
  readonly confidence: number;
  readonly evidence: readonly RoleEvidence[];
}

export interface SpeakerInput {
  readonly speakerLabel: string;
  readonly text: string;
}

/**
 * Abaixo disto o papel fica `unknown` em vez de ser adivinhado.
 *
 * Um palpite errado é pior que um "não sei": a nota sairia atribuindo a queixa
 * ao médico e a conduta ao paciente, com aparência de correção. `unknown` faz a
 * interface pedir confirmação, que é o comportamento certo quando não há base.
 */
export const MIN_CONFIDENCE = 0.25;

/**
 * Sinais de quem conduz a consulta.
 *
 * Os pesos não são arbitrários: refletem quão exclusivo é cada sinal. Um
 * paciente nunca diz "vou solicitar um exame"; já "exame" sozinho aparece na
 * boca dos dois. Sinal exclusivo pesa mais.
 */
const SINAIS_PROFISSIONAL: readonly [RegExp, number, string][] = [
  // Conduta — exclusivos de quem prescreve
  [
    /\bvou (pedir|solicitar|prescrever|passar|receitar|encaminhar)\b/i,
    5,
    "anuncia conduta",
  ],
  [/\b(prescrev|receit)\w*\b/i, 4, "fala em prescrição"],
  [/\bquero (te )?(rever|ver) (você|a senhora|o senhor)\b/i, 4, "marca retorno"],
  [/\b(retorn[ae]|volta) (em|daqui a|depois de)\b/i, 3, "marca retorno"],
  [/\bvamos (fazer|pedir|solicitar|começar|tentar)\b/i, 3, "propõe conduta"],

  // Anamnese — a estrutura da entrevista clínica
  [/\bh[áa] quanto tempo\b/i, 4, "pergunta duração"],
  [/\bdesde quando\b/i, 4, "pergunta duração"],
  [/\bo que (te |lhe )?(trouxe|traz)\b/i, 5, "abre a consulta"],
  [/\b(toma|tomou|usa|faz uso de) (alguma|algum)\b/i, 4, "pergunta medicação"],
  [/\balguma (alergia|medicação|doença|cirurgia)\b/i, 4, "pergunta antecedentes"],
  [/\bj[áa] (teve|sentiu|fez)\b/i, 3, "pergunta antecedentes"],
  [/\b(alguém|algum caso) na família\b/i, 3, "pergunta história familiar"],

  // Exame físico — comandos que só quem examina dá
  [
    /\b(respira|inspira|deita|senta|levanta|abre a boca|tira|vira)\b/i,
    3,
    "comanda exame",
  ],
  [/\b(sua |a )?press[ãa]o (est[áa]|t[áa]|arterial)\b/i, 3, "afere sinais"],
  [/\bvou (examinar|auscultar|palpar|medir|olhar)\b/i, 4, "conduz exame"],

  // Apresentação com credencial
  [
    /\bsou (médic[oa]|nutricionista|psicólog[oa]|fisioterapeuta|dentista)\b/i,
    5,
    "declara profissão",
  ],
  [/\b(formad[oa]|especialista) (h[áa]|em)\b/i, 4, "declara formação"],

  // Tranquilizar e orientar — postura de quem conduz
  [/\bfica (à|a) vontade\b/i, 2, "acolhe"],
  [/\b(pode|fique) (ficar |ficar\s)?(tranquil[oa]|calm[oa])\b/i, 2, "tranquiliza"],
];

/**
 * Sinais de quem é atendido.
 *
 * O mais forte de todos é o tratamento: numa consulta brasileira o paciente
 * chama o profissional de "doutor" ou "doutora" o tempo todo, e o profissional
 * praticamente nunca usa a palavra. É quase um identificador.
 */
const SINAIS_PACIENTE: readonly [RegExp, number, string][] = [
  [/\b(doutor|doutora|dr\.|dra\.)\b/i, 5, "chama de doutor"],
  [/\b(eu )?(t[ôo]|estou|tenho) (com |sentindo |uma |um )/i, 4, "relata sintoma"],
  [/\b(me )?(d[óo]i|doeu|d[óo]em)\b/i, 4, "relata dor"],
  [/\beu (sinto|senti|comecei|acordei|fiquei)\b/i, 4, "relata em primeira pessoa"],
  [/\b(faz|h[áa]) \w+ (dias?|semanas?|meses|anos?)\b/i, 2, "responde duração"],
  [/\btomei\b/i, 3, "relata o que tomou"],
  [
    /\b(minha|meu) (dor|peito|barriga|cabeça|perna|braço|filh[oa])\b/i,
    2,
    "fala do próprio corpo",
  ],
  [/\bn[ãa]o (sei|melhorou|aliviou|consigo)\b/i, 2, "responde negativamente"],
];

/** Trechos que terminam em interrogação — quem pergunta costuma conduzir. */
const PESO_PERGUNTA = 1.5;

/**
 * Evidência mínima para um rótulo entrar na checagem de contradição.
 *
 * Abaixo disto o rótulo é ruído estatístico: um único "tomei" solto não diz
 * que o rótulo está contaminado, diz que mal há o que analisar.
 */
const EVIDENCIA_MINIMA = 6;

function acumular(
  texto: string,
  sinais: readonly [RegExp, number, string][],
  sentido: 1 | -1,
  evidencias: RoleEvidence[],
  vistos: Set<string>,
): number {
  let total = 0;
  for (const [padrao, peso, descricao] of sinais) {
    const achado = padrao.exec(texto);
    if (achado === null) continue;
    total += peso * sentido;
    // Uma evidência por tipo de sinal: repetir "chama de doutor" quinze vezes
    // não informa mais que uma, e polui a tela.
    if (!vistos.has(descricao)) {
      vistos.add(descricao);
      evidencias.push({
        signal: descricao,
        excerpt: texto.trim().slice(0, 90),
        weight: peso * sentido,
      });
    }
  }
  return total;
}

/**
 * Decide o papel de cada falante pelo conteúdo do que disse.
 *
 * Determinístico, sem rede, sem IA. Roda no plano grátis sem custo e sem
 * possibilidade de alucinar — o que ele não sabe, ele marca como `unknown` em
 * vez de inventar.
 */
export function identifyRolesByContent(
  segments: readonly SpeakerInput[],
): SpeakerAssignment[] {
  const porFalante = new Map<
    string,
    {
      /** Pontos de sinal profissional acumulados neste rótulo. */
      pro: number;
      /** Pontos de sinal paciente. SEPARADO de `pro`, nunca somado num saldo:
       *  é a diferença entre os dois que revela rótulo contaminado. */
      pac: number;
      trechos: number;
      evidencias: RoleEvidence[];
      vistos: Set<string>;
    }
  >();

  for (const seg of segments) {
    const atual = porFalante.get(seg.speakerLabel) ?? {
      pro: 0,
      pac: 0,
      trechos: 0,
      evidencias: [],
      vistos: new Set<string>(),
    };
    atual.trechos += 1;
    if (seg.text.trimEnd().endsWith("?")) atual.pro += PESO_PERGUNTA;
    atual.pro += acumular(
      seg.text,
      SINAIS_PROFISSIONAL,
      1,
      atual.evidencias,
      atual.vistos,
    );
    atual.pac += Math.abs(
      acumular(seg.text, SINAIS_PACIENTE, -1, atual.evidencias, atual.vistos),
    );
    porFalante.set(seg.speakerLabel, atual);
  }

  if (porFalante.size === 0) return [];

  const entradas = [...porFalante.entries()].map(([label, d]) => {
    const total = d.pro + d.pac;
    return {
      label,
      // Normalizar pelo número de trechos evita que quem simplesmente falou
      // mais vença por volume. O papel está em COMO se fala, não em quanto.
      pontuacao: d.trechos > 0 ? (d.pro - d.pac) / Math.sqrt(d.trechos) : 0,
      /**
       * Quão unilateral é a evidência deste rótulo, de 0 a 1.
       *
       * 1 significa que só apareceram sinais de um lado — rótulo limpo.
       * Perto de 0 significa que o rótulo tem sinais fortes dos DOIS papéis, o
       * que só acontece quando a diarização misturou as pessoas. Nesse caso
       * nenhuma agregação por rótulo pode estar certa, e a resposta honesta é
       * não decidir.
       */
      evidenciaTotal: total,
      // Ausência de sinal NÃO é contradição. Um rótulo calado — alguém que só
      // disse "sim" e "certo" — não contamina nada; ele simplesmente não
      // informa, e disso a separação entre pontuações já dá conta. Tratar os
      // dois casos igual zerava a confiança em consultas perfeitamente
      // identificáveis.
      pureza: total > 0 ? Math.abs(d.pro - d.pac) / total : 1,
      evidencias: d.evidencias,
    };
  });

  entradas.sort((a, b) => b.pontuacao - a.pontuacao);

  const lider = entradas[0];
  if (lider === undefined) return [];

  // A confiança vem da SEPARAÇÃO entre o primeiro e o segundo, não da
  // pontuação absoluta. Dois falantes com pontos parecidos significam que o
  // conteúdo não distingue — e aí o honesto é dizer que não sabe.
  const segundo = entradas[1];
  const separacao =
    segundo === undefined
      ? Math.abs(lider.pontuacao)
      : lider.pontuacao - segundo.pontuacao;
  // A confiança vem do rótulo MAIS limpo, não do mais contaminado.
  //
  // Identificar UM falante com segurança já determina os outros: numa conversa
  // de duas pessoas, saber quem é o paciente diz quem é o profissional. Exigir
  // que todos os rótulos estivessem limpos fazia o sistema recusar decisões que
  // sabia tomar — medido numa consulta real, onde a paciente era inequívoca
  // (chama de "doutor" quatro vezes, relata sintoma seis) e o rótulo do médico
  // vinha misturado.
  //
  // O caso realmente sem saída — TODOS os rótulos contaminados — continua
  // barrado, porque aí nem o mais limpo é limpo.
  const comEvidencia = entradas.filter((e) => e.evidenciaTotal >= EVIDENCIA_MINIMA);
  const purezaUtil =
    comEvidencia.length > 0 ? Math.max(...comEvidencia.map((e) => e.pureza)) : 1;
  const confianca = Math.min(1, Math.abs(separacao) / 6) * purezaUtil;

  // Duas perguntas diferentes, duas ordenações.
  //
  // Quem é o profissional? O de MAIOR pontuação.
  // Quem é o paciente? Entre os restantes, o de MENOR — o mais paciente-like.
  //
  // Usar uma ordenação só para as duas inverte o resultado com três falantes:
  // o acompanhante é neutro (pontuação ~0) e fica acima do paciente, que é
  // fortemente negativo. O segundo colocado seria o acompanhante, não o
  // paciente.
  const papeis = new Map<string, SpeakerRole>();
  papeis.set(lider.label, "professional");

  const restantes = entradas.slice(1).sort((a, b) => a.pontuacao - b.pontuacao);
  restantes.forEach((e, i) => {
    papeis.set(e.label, i === 0 ? "patient" : "other");
  });

  return entradas.map((e) => {
    const evidencias = [...e.evidencias].sort(
      (a, b) => Math.abs(b.weight) - Math.abs(a.weight),
    );
    return {
      speakerLabel: e.label,
      role:
        confianca < MIN_CONFIDENCE
          ? ("unknown" as const)
          : (papeis.get(e.label) ?? ("unknown" as const)),
      confidence: confianca,
      evidence: evidencias.slice(0, 4),
    };
  });
}

/** Troca profissional e paciente — a correção manual da interface. */
export function swapRoles(
  assignments: readonly SpeakerAssignment[],
): SpeakerAssignment[] {
  return assignments.map((a) => ({
    ...a,
    role:
      a.role === "professional"
        ? ("patient" as const)
        : a.role === "patient"
          ? ("professional" as const)
          : a.role,
    // Correção humana é verdade, não estimativa.
    confidence: 1,
  }));
}

/** Mapa pronto para aplicar aos trechos. */
export function roleByLabel(
  assignments: readonly SpeakerAssignment[],
): Record<string, SpeakerRole> {
  const mapa: Record<string, SpeakerRole> = {};
  for (const a of assignments) mapa[a.speakerLabel] = a.role;
  return mapa;
}
