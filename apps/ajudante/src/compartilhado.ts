/**
 * O contrato entre o processo principal e a janela — os dois lados importam
 * daqui, e só daqui, o formato do que trocam.
 */

import type { IdDaEtapa } from "./logica/etapas";

export type ModoDaInstalacao = "instalar" | "reinstalar";

/** O que a tela de escolha precisa saber antes de a pessoa escolher. */
export interface Situacao {
  readonly instalado: boolean;
  readonly versaoInstalada: string | null;
  readonly versaoDestePrograma: string;
  /** Python, motor e modelos no lugar — sem isso, "instalado" é só o programa. */
  readonly motorPronto: boolean;
  readonly placa: { readonly dispositivo: "cuda" | "cpu"; readonly explicacao: string };
  readonly espacoLivre: number;
  readonly espacoNecessario: number;
  /** A janela abriu para escolher, ou direto na desinstalação (Configurações do Windows). */
  readonly abertaPara: "escolher" | "desinstalar";
}

export interface Progresso {
  readonly etapa: IdDaEtapa;
  readonly rotulo: string;
  readonly percentual: number;
  readonly detalhe: string;
}

export type Resultado =
  | { readonly ok: true }
  | { readonly ok: false; readonly mensagem: string; readonly detalhes: string };

/** O que a janela pode pedir ao programa — exposto por `preload.ts`. */
export interface ApiDoAjudante {
  situacao(): Promise<Situacao>;
  instalar(modo: ModoDaInstalacao): Promise<Resultado>;
  desinstalar(): Promise<Resultado>;
  aoProgresso(ouvinte: (progresso: Progresso) => void): () => void;
  /** Teste automatizado (`AJUDANTE_ACAO`): o programa aperta o botão pela pessoa. */
  aoPedido(ouvinte: (opcao: ModoDaInstalacao | "desinstalar") => void): void;
  /** Fecha a janela; o ajudante segue na bandeja. */
  concluir(): void;
  /** Encerra de vez (depois de desinstalar). */
  sair(): void;
  copiar(texto: string): void;
}
