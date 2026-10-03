/**
 * A ponte entre a janela e o programa — e o único caminho entre os dois.
 *
 * A janela não tem Node: só pode pedir o que está aqui, pelo nome.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { ApiDoAjudante, ModoDaInstalacao, Progresso } from "./compartilhado";

const api: ApiDoAjudante = {
  situacao: () => ipcRenderer.invoke("situacao"),
  instalar: (modo: ModoDaInstalacao) => ipcRenderer.invoke("instalar", modo),
  desinstalar: () => ipcRenderer.invoke("desinstalar"),
  aoProgresso: (ouvinte) => {
    const repassar = (_evento: IpcRendererEvent, progresso: Progresso) =>
      ouvinte(progresso);
    ipcRenderer.on("progresso", repassar);
    return () => ipcRenderer.removeListener("progresso", repassar);
  },
  aoPedido: (ouvinte) => {
    ipcRenderer.on("pedido", (_evento, opcao: ModoDaInstalacao | "desinstalar") =>
      ouvinte(opcao),
    );
  },
  concluir: () => ipcRenderer.send("concluir"),
  conectar: () => ipcRenderer.send("conectar"),
  sair: () => ipcRenderer.send("sair"),
  copiar: (texto: string) => ipcRenderer.send("copiar", texto),
};

contextBridge.exposeInMainWorld("ajudante", api);
