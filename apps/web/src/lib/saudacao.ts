/**
 * O começo da tela inicial: a saudação, a data e o resumo do dia.
 *
 * É a primeira frase que o profissional lê, e ela troca números por palavras
 * de propósito — "duas notas estão prontas para você revisar" se entende de
 * relance; "revisões pendentes: 2" pede para ser interpretado.
 */

export type Periodo = "manha" | "tarde" | "noite";

/**
 * O fuso do Brasil que mais gente usa.
 *
 * A tela é montada no servidor, que não sabe em que fuso a pessoa está. O
 * horário de Brasília acerta para a maior parte do país; em Manaus ou no Acre
 * a saudação pode chegar uma hora adiantada, o que é um erro que ninguém nota.
 */
export const FUSO_PADRAO = "America/Sao_Paulo";

export function periodoDoDia(agora: Date, fuso: string = FUSO_PADRAO): Periodo {
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: fuso,
    }).format(agora),
  );
  if (hora >= 5 && hora < 12) return "manha";
  if (hora >= 12 && hora < 18) return "tarde";
  return "noite";
}

export const SAUDACAO: Record<Periodo, string> = {
  manha: "Bom dia",
  tarde: "Boa tarde",
  noite: "Boa noite",
};

/** "Terça-feira, 29 de setembro". */
export function dataPorExtenso(agora: Date, fuso: string = FUSO_PADRAO): string {
  const texto = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: fuso,
  }).format(agora);
  return texto.charAt(0).toLocaleUpperCase("pt-BR") + texto.slice(1);
}

/**
 * O nome com que a tela chama a pessoa.
 *
 * O primeiro nome — e o título junto, quando ele vem escrito: quem se
 * cadastrou como "Dra. Ana Ribeiro" escolheu ser chamada assim, e "Bom dia,
 * Dra." sozinho seria o pior dos dois mundos.
 */
const TITULOS = /^(dra?|prof(a|ª)?|sra?)\.?$/i;

export function primeiroNome(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const [primeira, segunda] = partes;
  if (primeira === undefined) return "";
  if (TITULOS.test(primeira) && segunda !== undefined) return `${primeira} ${segunda}`;
  return primeira;
}

/** O dia do calendário em que `data` cai no fuso, como número de dias. */
function diaDoCalendario(data: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: fuso,
  }).formatToParts(data);
  const valor = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  return Date.UTC(valor("year"), valor("month") - 1, valor("day")) / 86_400_000;
}

/**
 * Há quanto tempo, do jeito que se fala: "hoje", "ontem", "há 3 dias".
 *
 * Conta dias de CALENDÁRIO no fuso, e não blocos de 24 horas: a consulta das
 * 23h de ontem, vista às 8h de hoje, foi "ontem" — e não "hoje" só porque
 * passaram menos de 24 horas.
 */
export function haQuanto(data: Date, agora: Date, fuso: string = FUSO_PADRAO): string {
  const dias = diaDoCalendario(agora, fuso) - diaDoCalendario(data, fuso);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  if (dias < 14) return "há 1 semana";
  if (dias < 30) return `há ${Math.floor(dias / 7)} semanas`;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    timeZone: fuso,
  })
    .format(data)
    .replace(".", "");
}

const POR_EXTENSO = [
  "",
  "uma",
  "duas",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
  "dez",
];

/** Quantidade no feminino ("nota", "consulta"), por extenso até dez. */
function quantas(n: number): string {
  return POR_EXTENSO[n] ?? String(n);
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase("pt-BR") + texto.slice(1);
}

/**
 * Uma ou duas frases sobre o que espera o profissional.
 *
 * O que vem primeiro é o que depende dele — nota para revisar. O que ainda
 * está sendo escrito aparece depois, porque não pede nada agora.
 */
export function resumoDoDia(paraRevisar: number, emAndamento: number): string {
  const frases: string[] = [];

  if (paraRevisar === 1) {
    frases.push("Uma nota está pronta para você revisar.");
  } else if (paraRevisar > 1) {
    frases.push(
      `${maiuscula(quantas(paraRevisar))} notas estão prontas para você revisar.`,
    );
  }

  if (emAndamento === 1) {
    frases.push("Uma consulta ainda está sendo escrita.");
  } else if (emAndamento > 1) {
    frases.push(
      `${maiuscula(quantas(emAndamento))} consultas ainda estão sendo escritas.`,
    );
  }

  if (frases.length === 0) return "Tudo em dia. Nenhuma nota esperando por você.";
  if (paraRevisar > 0 && emAndamento === 0) frases.push("O resto está em dia.");
  return frases.join(" ");
}
