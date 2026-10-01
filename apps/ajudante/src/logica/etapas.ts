/**
 * As etapas da instalação, e quanto cada uma pesa na barra de progresso.
 *
 * Os pesos são o tempo aproximado de cada etapa numa conexão comum: baixar o
 * motor e os modelos é quase tudo. Uma barra que anda no ritmo do tempo real é
 * o que faz a espera parecer honesta.
 */

export type IdDaEtapa =
  "conferir" | "programa" | "python" | "motor" | "modelos" | "testar" | "concluir";

export interface Etapa {
  readonly id: IdDaEtapa;
  readonly rotulo: string;
  readonly peso: number;
}

export const ETAPAS: readonly Etapa[] = [
  { id: "conferir", rotulo: "Conferindo o computador", peso: 1 },
  { id: "programa", rotulo: "Instalando o ajudante", peso: 2 },
  { id: "python", rotulo: "Preparando o Python", peso: 4 },
  { id: "motor", rotulo: "Instalando o motor de transcrição", peso: 43 },
  { id: "modelos", rotulo: "Baixando os modelos de voz", peso: 40 },
  { id: "testar", rotulo: "Testando o motor", peso: 8 },
  { id: "concluir", rotulo: "Deixando tudo pronto", peso: 2 },
];

const TOTAL = ETAPAS.reduce((soma, etapa) => soma + etapa.peso, 0);

/** De 0 a 100: as etapas anteriores inteiras, mais a fração da atual. */
export function percentual(etapa: IdDaEtapa, fracaoDaEtapa: number): number {
  let antes = 0;
  for (const e of ETAPAS) {
    if (e.id === etapa) {
      const fracao = Math.min(1, Math.max(0, fracaoDaEtapa));
      return Math.round(((antes + e.peso * fracao) / TOTAL) * 1000) / 10;
    }
    antes += e.peso;
  }
  return 0;
}

export function rotuloDe(etapa: IdDaEtapa): string {
  return ETAPAS.find((e) => e.id === etapa)?.rotulo ?? "";
}

/** "1,2 GB de 3,1 GB" — como a pessoa lê tamanho de download. */
export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 / 1024)} MB`;
  const gb = bytes / 1024 ** 3;
  return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1).replace(".", ",")} GB`;
}
