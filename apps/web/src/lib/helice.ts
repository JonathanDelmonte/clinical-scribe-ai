/**
 * A Hélice da conversa — a assinatura visual de cada consulta.
 *
 * Duas fitas entrelaçadas, uma do profissional e uma do paciente, e cada fita
 * engrossa onde aquela pessoa está falando. Não é enfeite: de relance ela diz
 * quem conduziu a consulta e onde está a fala de cada um, e é sobre ela que a
 * revisão marca o momento que sustenta uma frase da nota.
 *
 * Sai inteira do que o banco já guarda em `transcript_segments` — papel, início
 * e fim de cada trecho. Pura e sem DOM, para poder ser testada.
 */

export interface Fala {
  readonly role: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface Helice {
  /** O `d` da fita do profissional, num viewBox `0 0 largura altura`. */
  readonly voce: string;
  /** O `d` da fita do paciente (e de acompanhantes). */
  readonly paciente: string;
}

export interface OpcoesDaHelice {
  readonly largura?: number;
  readonly altura?: number;
  /** Quantas vezes as fitas se cruzam de ponta a ponta. */
  readonly voltas?: number;
  /** Pontos por fita. Mais pontos, curva mais lisa — e caminho mais longo. */
  readonly pontos?: number;
  /** Quanto a fita fica aberta quando a pessoa está calada, de 0 a 1. */
  readonly piso?: number;
}

/**
 * Acompanhante entra na fita do paciente.
 *
 * A pergunta que a hélice responde é "quem é o profissional e quem não é" — a
 * mesma decisão de produto da separação de vozes (§7 da documentação). E
 * `unknown` fica de fora: desenhar uma fala sem dono numa das fitas afirmaria
 * uma autoria que ninguém confirmou.
 */
const DO_PACIENTE = new Set(["patient", "other"]);

export function duracaoDaConversa(falas: readonly Fala[]): number {
  return falas.reduce((maior, f) => Math.max(maior, f.endMs), 0);
}

export function desenharHelice(
  falas: readonly Fala[],
  opcoes: OpcoesDaHelice = {},
): Helice | null {
  const {
    largura = 1000,
    altura = 100,
    voltas = 21,
    pontos = 251,
    piso = 0.16,
  } = opcoes;

  const total = duracaoDaConversa(falas);
  if (falas.length === 0 || total <= 0 || pontos < 2) return null;

  const voce = new Float64Array(pontos);
  const paciente = new Float64Array(pontos);
  const passo = total / (pontos - 1);

  // Marca, em cada fita, os pontos em que alguém daquele lado estava falando.
  // Um passe por trecho, sem varrer a conversa inteira para cada ponto.
  for (const f of falas) {
    const fita =
      f.role === "professional" ? voce : DO_PACIENTE.has(f.role) ? paciente : null;
    if (fita === null) continue;
    const de = Math.max(0, Math.floor(f.startMs / passo));
    const ate = Math.min(pontos - 1, Math.ceil(f.endMs / passo));
    for (let i = de; i <= ate; i++) fita[i] = 1;
  }

  const raio = Math.max(1, Math.round(pontos / 90));
  const lisaVoce = suavizar(voce, raio);
  const lisaPaciente = suavizar(paciente, raio);

  const meio = altura / 2;
  const amplitude = altura * 0.4;
  const a: string[] = [];
  const b: string[] = [];

  for (let i = 0; i < pontos; i++) {
    const x = arredondar((largura * i) / (pontos - 1));
    const onda = Math.sin((2 * Math.PI * voltas * i) / (pontos - 1));
    const aberturaVoce = piso + (1 - piso) * (lisaVoce[i] ?? 0);
    const aberturaPaciente = piso + (1 - piso) * (lisaPaciente[i] ?? 0);
    // Sinais opostos: as fitas se cruzam nos mesmos nós, como numa hélice.
    a.push(`${x} ${arredondar(meio + amplitude * aberturaVoce * onda)}`);
    b.push(`${x} ${arredondar(meio - amplitude * aberturaPaciente * onda)}`);
  }

  return { voce: `M${a.join("L")}`, paciente: `M${b.join("L")}` };
}

/** Onde um instante da consulta cai na hélice, em porcentagem da largura. */
export function posicaoNaConversa(ms: number, totalMs: number): number {
  if (totalMs <= 0) return 0;
  return Math.min(100, Math.max(0, (ms / totalMs) * 100));
}

/**
 * Média com peso gaussiano.
 *
 * Sem ela, a fita pula de fina para grossa no instante exato em que a fala
 * troca de lado, e a hélice vira um código de barras. Suavizada, ela incha e
 * desincha — e continua dizendo a mesma coisa.
 */
function suavizar(valores: Float64Array, raio: number): Float64Array {
  const saida = new Float64Array(valores.length);
  const alcance = raio * 3;

  for (let i = 0; i < valores.length; i++) {
    let soma = 0;
    let pesos = 0;
    for (let k = -alcance; k <= alcance; k++) {
      const j = i + k;
      if (j < 0 || j >= valores.length) continue;
      const peso = Math.exp(-(k * k) / (2 * raio * raio));
      soma += peso * (valores[j] ?? 0);
      pesos += peso;
    }
    saida[i] = pesos === 0 ? 0 : soma / pesos;
  }

  return saida;
}

/** Uma casa decimal basta para o olho, e encurta o caminho pela metade. */
function arredondar(n: number): number {
  return Math.round(n * 10) / 10;
}
