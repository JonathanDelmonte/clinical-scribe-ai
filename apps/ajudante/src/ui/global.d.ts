import type { ApiDoAjudante } from "../compartilhado";

declare global {
  interface Window {
    /** Exposto por `preload.ts`: o único caminho da janela até o programa. */
    readonly ajudante: ApiDoAjudante;
  }
}

export {};
