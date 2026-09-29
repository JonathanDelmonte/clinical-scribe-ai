/**
 * O teleprompter do cadastro de voz: o que ler, onde a pessoa está na leitura
 * e o que foi ouvido de cada frase.
 *
 * ## Duas velocidades, de propósito
 *
 * O avanço da leitura e a conferência do que foi dito andam em ritmos
 * diferentes, e misturar os dois estragaria ambos.
 *
 * - **O avanço é imediato.** Sai só da energia do microfone: fala acumulada
 *   na frase e a pausa no fim dela. Não erra por sotaque nem por palavra
 *   difícil, e responde no mesmo quadro de 30 ms em que a voz chega.
 * - **A conferência chega depois.** Cada trecho entre pausas vai inteiro para
 *   o Whisper do navegador, e o texto que volta é alinhado ao roteiro. Frase
 *   inteira dá ao modelo o contexto que um pedaço de meio segundo não dá; é
 *   mais lento, e é bem mais certo.
 *
 * Se a conferência mandasse no avanço, a tela ficaria parada esperando o
 * modelo enquanto a pessoa já lê a frase seguinte. Se o avanço decidisse o
 * que foi "ouvido", toda tosse contaria como palavra lida.
 */

import { limiarDb } from "@scribe/audio-browser";

// ---------------------------------------------------------------------------
// O roteiro
// ---------------------------------------------------------------------------

/**
 * As frases de consulta que seguem a apresentação.
 *
 * A impressão vocal fica melhor quando a amostra tem os sons que vão aparecer
 * nas consultas, por isso frases de atendimento, e não um texto qualquer.
 */
const FRASES_DE_CONSULTA = [
  "Esta é uma amostra da minha voz para o sistema me reconhecer nas consultas.",
  "Bom dia, boa tarde, boa noite. Fique à vontade.",
  "Há quanto tempo você sente isso? Vou pedir alguns exames.",
  "Quero rever você em duas semanas.",
] as const;

/** Títulos não se leem em voz alta numa apresentação: "Meu nome é Ana". */
const TITULOS = /^(dra?|prof(a|ª)?|sra?)\.?$/i;

/** O nome como a pessoa diria: sem título e sem comentário entre parênteses. */
export function nomeParaLeitura(nome: string): string {
  return nome
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .split(/\s+/)
    .filter((p) => p !== "" && !TITULOS.test(p))
    .join(" ");
}

/**
 * O que ler, com a primeira frase já preenchida.
 *
 * "Meu nome é [seu nome]" obrigava a pessoa a traduzir o colchete em voz alta,
 * no meio da leitura. Com o nome e a área escritos, basta ler. "Trabalho com
 * nutrição", e não "sou nutricionista": o nome da profissão muda com o gênero,
 * e o sistema não sabe qual usar.
 */
export function roteiroDeVoz({
  nome,
  especialidade,
}: {
  nome?: string | null | undefined;
  especialidade?: string | null | undefined;
}): string[] {
  const quem = nomeParaLeitura(nome ?? "");
  const area = (especialidade ?? "").trim();

  const apresentacao =
    quem === ""
      ? "Olá, esta é a minha voz."
      : area === "" || area === "outra"
        ? `Meu nome é ${quem}.`
        : `Meu nome é ${quem} e eu trabalho com ${area}.`;

  return [apresentacao, ...FRASES_DE_CONSULTA];
}

export interface PalavraDoRoteiro {
  /** Como aparece na tela, com a pontuação grudada. */
  readonly texto: string;
  /** Minúscula, sem acento e sem pontuação. Vazia se o pedaço era só sinal. */
  readonly chave: string;
  readonly frase: number;
}

export interface Roteiro {
  readonly frases: readonly string[];
  /** Todas as palavras, na ordem de leitura. */
  readonly palavras: readonly PalavraDoRoteiro[];
  /** Índice, em `palavras`, da primeira palavra de cada frase. */
  readonly inicioDaFrase: readonly number[];
}

export function montarRoteiro(frases: readonly string[]): Roteiro {
  const palavras: PalavraDoRoteiro[] = [];
  const inicioDaFrase: number[] = [];

  frases.forEach((frase, indice) => {
    inicioDaFrase.push(palavras.length);
    for (const texto of frase.trim().split(/\s+/)) {
      if (texto === "") continue;
      palavras.push({ texto, chave: palavrasDe(texto)[0] ?? "", frase: indice });
    }
  });

  return { frases, palavras, inicioDaFrase };
}

/** As palavras da frase, em ordem, com o índice global de cada uma. */
export function palavrasDaFrase(
  roteiro: Roteiro,
  frase: number,
): { palavra: PalavraDoRoteiro; indice: number }[] {
  const inicio = roteiro.inicioDaFrase[frase] ?? roteiro.palavras.length;
  const fim = roteiro.inicioDaFrase[frase + 1] ?? roteiro.palavras.length;
  const saida: { palavra: PalavraDoRoteiro; indice: number }[] = [];
  for (let i = inicio; i < fim; i++) {
    const palavra = roteiro.palavras[i];
    if (palavra !== undefined) saida.push({ palavra, indice: i });
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Comparar o que foi ouvido com o que estava escrito
// ---------------------------------------------------------------------------

/** Minúsculas, sem acento, sem pontuação. "Vontade." e "vontade" são a mesma. */
export function palavrasDe(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((p) => p !== "");
}

/** O Whisper escreve "2 semanas" tanto quanto "duas semanas". */
const NUMEROS: Readonly<Record<string, readonly string[]>> = {
  "0": ["zero"],
  "1": ["um", "uma"],
  "2": ["dois", "duas"],
  "3": ["tres"],
  "4": ["quatro"],
  "5": ["cinco"],
  "6": ["seis"],
  "7": ["sete"],
  "8": ["oito"],
  "9": ["nove"],
  "10": ["dez"],
  "15": ["quinze"],
  "30": ["trinta"],
};

/** Distância de edição, com saída antecipada acima do limite. */
function distancia(a: string, b: string, limite: number): number {
  if (Math.abs(a.length - b.length) > limite) return limite + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      const valor = Math.min(
        (anterior[j] ?? 0) + 1,
        (atual[j - 1] ?? 0) + 1,
        (anterior[j - 1] ?? 0) + custo,
      );
      atual.push(valor);
      menor = Math.min(menor, valor);
    }
    if (menor > limite) return limite + 1;
    anterior = atual;
  }
  return anterior[b.length] ?? limite + 1;
}

/**
 * A palavra ouvida vale pela escrita?
 *
 * Tolerante, porque o que se confere é leitura, não ortografia: o modelo do
 * navegador troca "consultas" por "consulta" e "reconhecer" por "reconhece",
 * e nenhum dos dois é erro de quem leu. Palavras curtas precisam ser iguais:
 * com uma letra de folga, "boa" viraria "bom" e "e" viraria qualquer coisa.
 */
export function parecida(ouvida: string, esperada: string): boolean {
  if (ouvida === esperada) return true;
  if (NUMEROS[ouvida]?.includes(esperada) === true) return true;
  if (NUMEROS[esperada]?.includes(ouvida) === true) return true;

  const menor = Math.min(ouvida.length, esperada.length);
  if (menor < 4) return false;

  if (
    (ouvida.startsWith(esperada) || esperada.startsWith(ouvida)) &&
    Math.abs(ouvida.length - esperada.length) <= 2
  ) {
    return true;
  }

  const limite = menor >= 7 ? 2 : 1;
  return distancia(ouvida, esperada, limite) <= limite;
}

export interface Conferencia {
  /** Índices, em `roteiro.palavras`, das palavras que o modelo ouviu. */
  readonly ouvidas: ReadonlySet<number>;
  /** Daqui para a frente ainda não foi ouvido nada. Só anda para a frente. */
  readonly cursor: number;
}

export const CONFERENCIA_INICIAL: Conferencia = { ouvidas: new Set(), cursor: 0 };

/** Até quantas palavras à frente uma palavra ouvida pode ser procurada. */
const JANELA = 6;

/**
 * Alinha o texto de um trecho ao roteiro.
 *
 * Guloso e só para a frente: cada palavra ouvida procura sua par nas próximas
 * palavras do roteiro, a partir de onde a anterior parou. Palavra que o modelo
 * engoliu fica para trás sem marca; palavra que ele inventou não encontra par
 * e é ignorada. Reler um trecho não desfaz nada.
 *
 * `dica` é onde o teleprompter acha que o trecho começou. Serve para quando o
 * modelo perdeu uma frase inteira: sem ela, o cursor ficaria preso no começo
 * da frase perdida, e nenhuma palavra das seguintes caberia na janela.
 * Palavras curtas não usam a dica, e só valem logo depois de uma palavra que
 * já casou: "a", "e" e "o" aparecem em toda frase, e soltas fariam o cursor
 * saltar por acaso. Numa releitura de "meu nome é", o "é" casaria com o "é"
 * da frase seguinte.
 */
export function conferir(
  roteiro: Roteiro,
  anterior: Conferencia,
  transcrito: string,
  dica = 0,
): Conferencia {
  const ouvidas = new Set(anterior.ouvidas);
  let cursor = anterior.cursor;
  let ancorada = false;

  for (const ouvida of palavrasDe(transcrito)) {
    const curta = ouvida.length <= 2;
    if (curta && !ancorada) continue;

    ancorada = false;
    const fim = curta
      ? cursor + 2
      : Math.max(cursor + JANELA, Math.max(dica, cursor) + JANELA);

    for (let i = cursor; i < fim; i++) {
      const alvo = roteiro.palavras[i];
      if (alvo === undefined) break;
      if (alvo.chave !== "" && parecida(ouvida, alvo.chave)) {
        ouvidas.add(i);
        cursor = i + 1;
        ancorada = true;
        break;
      }
    }
  }

  return { ouvidas, cursor };
}

export interface ResultadoDaFrase {
  readonly acertos: number;
  readonly total: number;
  /** De 0 a 1. */
  readonly fracao: number;
}

/**
 * Quanto da frase foi ouvido.
 *
 * Conta só palavras de três letras ou mais. "À", "é" e "o" são as que o modelo
 * mais engole e as que menos dizem se a frase foi lida; contá-las puniria a
 * leitura certa pelo defeito do reconhecedor.
 */
export function resultadoDaFrase(
  roteiro: Roteiro,
  conferencia: Conferencia,
  frase: number,
): ResultadoDaFrase {
  const todas = palavrasDaFrase(roteiro, frase).filter(
    ({ palavra }) => palavra.chave !== "",
  );
  const contam = todas.some(({ palavra }) => palavra.chave.length >= 3)
    ? todas.filter(({ palavra }) => palavra.chave.length >= 3)
    : todas;

  const acertos = contam.filter(({ indice }) => conferencia.ouvidas.has(indice)).length;
  const total = contam.length;
  return { acertos, total, fracao: total === 0 ? 0 : acertos / total };
}

/** A partir daqui a frase conta como reconhecida. */
export const FRACAO_RECONHECIDA = 0.6;

/** Em que frase a conferência já chegou. `frases.length` se passou da última. */
export function fraseDoCursor(roteiro: Roteiro, conferencia: Conferencia): number {
  const palavra = roteiro.palavras[conferencia.cursor];
  if (palavra !== undefined) return palavra.frase;
  return roteiro.frases.length;
}

// ---------------------------------------------------------------------------
// O ritmo da leitura, quadro a quadro
// ---------------------------------------------------------------------------

/** O tamanho do quadro que o `audio-tap.js` entrega: 480 amostras a 16 kHz. */
export const QUADRO_MS = 30;

/**
 * Letras lidas por segundo de fala, sem contar as pausas.
 *
 * Leitura em voz alta, em português, fica perto disto. Não precisa ser exato:
 * a estimativa só decide quanto da frase aparece preenchido, e a pausa no fim
 * da frase é quem confirma a troca.
 */
const LETRAS_POR_SEGUNDO = 14;

export function duracaoEsperadaMs(frase: string): number {
  const letras = frase.normalize("NFD").match(/\p{L}/gu)?.length ?? 0;
  return Math.max(900, Math.round((letras / LETRAS_POR_SEGUNDO) * 1000));
}

export interface Ritmo {
  /** A frase sendo lida. Igual ao número de frases quando a leitura acabou. */
  readonly frase: number;
  /** Fala acumulada na frase atual. */
  readonly vozMs: number;
  /** Silêncio corrido até agora. */
  readonly silencioMs: number;
  /** Quadros seguidos com voz, para não tomar um estalo por fala. */
  readonly seguidos: number;
}

export const RITMO_INICIAL: Ritmo = { frase: 0, vozMs: 0, silencioMs: 0, seguidos: 0 };

/** Pausa que fecha uma frase. */
const PAUSA_MS = 450;
/** Uma respiração curta basta quando a frase já passou bastante do esperado. */
const FOLEGO_MS = 150;

/**
 * Um quadro de 30 ms de leitura.
 *
 * A frase troca em três casos, do mais comum ao de socorro:
 * 1. pausa de verdade depois de ler boa parte da frase;
 * 2. só um fôlego, mas depois de falar bem mais que o esperado (quem lê sem
 *    parar entre as frases);
 * 3. fala sem pausa nenhuma por mais do que o dobro do esperado.
 *
 * O ponto e a vírgula do meio da frase também dão pausa ("boa noite. Fique à
 * vontade"); por isso o primeiro caso exige 70% da frase já falada. Errar
 * para o lado do atraso é o erro barato: a conferência, quando chega, adianta
 * o teleprompter. Trocar de frase cedo demais mostraria a próxima enquanto a
 * pessoa ainda lê a atual.
 */
export function passoDoRitmo(ritmo: Ritmo, voz: boolean, esperadoMs: number): Ritmo {
  const seguidos = voz ? ritmo.seguidos + 1 : 0;
  // Dois quadros seguidos para começar a contar; depois, cada quadro com voz
  // conta, e o primeiro sem voz inicia o silêncio.
  const falou = voz && seguidos >= 2;
  const vozMs =
    ritmo.vozMs + (falou ? (seguidos === 2 ? 2 * QUADRO_MS : QUADRO_MS) : 0);
  const silencioMs = voz
    ? falou
      ? 0
      : ritmo.silencioMs
    : ritmo.silencioMs + QUADRO_MS;

  const troca =
    (silencioMs >= PAUSA_MS && vozMs >= esperadoMs * 0.7) ||
    (silencioMs >= FOLEGO_MS && vozMs >= esperadoMs * 1.45) ||
    vozMs >= esperadoMs * 2.2;

  if (troca) return { frase: ritmo.frase + 1, vozMs: 0, silencioMs: 0, seguidos: 0 };
  return { frase: ritmo.frase, vozMs, silencioMs, seguidos };
}

/** Pula para a frase indicada, se ela estiver à frente. Nunca volta. */
export function adiantarRitmo(ritmo: Ritmo, frase: number): Ritmo {
  if (frase <= ritmo.frase) return ritmo;
  return { frase, vozMs: 0, silencioMs: 0, seguidos: 0 };
}

/**
 * Quantas palavras da frase aparecem como já lidas.
 *
 * Pelo total de letras, e não pelo número de palavras: "Há" e "reconhecer"
 * não levam o mesmo tempo para dizer.
 */
export function palavrasLidas(frase: string, fracao: number): number {
  const palavras = frase
    .trim()
    .split(/\s+/)
    .filter((p) => p !== "");
  const tamanhos = palavras.map((p) =>
    Math.max(1, p.normalize("NFD").match(/\p{L}/gu)?.length ?? 0),
  );
  const total = tamanhos.reduce((s, t) => s + t, 0);
  if (total === 0) return 0;

  const alvo = Math.min(1, Math.max(0, fracao)) * total;
  let acumulado = 0;
  let lidas = 0;
  for (const t of tamanhos) {
    // A palavra acende quando a fala passou da metade dela: acender só no fim
    // deixaria o preenchimento sempre uma palavra atrás da voz.
    if (acumulado + t / 2 > alvo) break;
    acumulado += t;
    lidas++;
  }
  return lidas;
}

// ---------------------------------------------------------------------------
// Voz ou sala
// ---------------------------------------------------------------------------

/** Energia de um quadro (RMS). */
export function energiaDoQuadro(quadro: Float32Array): number {
  let soma = 0;
  for (let i = 0; i < quadro.length; i++) {
    const v = quadro[i] ?? 0;
    soma += v * v;
  }
  return quadro.length > 0 ? Math.sqrt(soma / quadro.length) : 0;
}

export function paraDb(energia: number): number {
  return 20 * Math.log10(Math.max(energia, 1e-9));
}

/** Nível entre 0 e 1, para o anel que mostra que o microfone está ouvindo. */
export function nivelVisual(energia: number): number {
  return Math.min(1, Math.max(0, (paraDb(energia) + 55) / 35));
}

/**
 * Decide, quadro a quadro, se há voz.
 *
 * O limiar é o mesmo da detecção do arquivo inteiro (`limiarDb`), calculado
 * sobre os últimos segundos. Com duas proteções para o começo, quando a
 * janela ainda só tem a sala: um piso absoluto, abaixo do qual nada é voz, e
 * um limiar fixo quando a sala ainda não mostrou dois níveis. Sem elas, o
 * ruído de fundo contaria como leitura antes da primeira palavra.
 */
export class DetectorDeVoz {
  private readonly janela: number[] = [];

  constructor(private readonly tamanho = 300) {}

  ouvir(energia: number): boolean {
    this.janela.push(energia);
    if (this.janela.length > this.tamanho) this.janela.shift();

    const limiar = limiarDb(this.janela, 0.35);
    const efetivo = limiar === Number.NEGATIVE_INFINITY ? -40 : Math.max(limiar, -50);
    return paraDb(energia) >= efetivo;
  }
}
