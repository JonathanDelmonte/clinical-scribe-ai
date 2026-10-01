/**
 * Conversas com o Windows: placa de vídeo, disco, atalhos, a lista de
 * programas instalados e o encerramento de processos.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { join, parse } from "node:path";

import { app, shell } from "electron";

import { lerNvidiaSmi, type PlacaDeVideo } from "../logica/maquina";
import { ID_DO_APLICATIVO, NOME_DO_EXECUTAVEL, NOME_DO_PROGRAMA } from "./caminhos";
import { rodar, rodarELer } from "./processo";
import { registrar } from "./registro";

const CHAVE_DE_DESINSTALACAO =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ConsultaVivaAjudante";

export async function detectarPlacas(): Promise<PlacaDeVideo[]> {
  try {
    const saida = await rodarELer("nvidia-smi", [
      "--query-gpu=name,memory.total,driver_version",
      "--format=csv,noheader,nounits",
    ]);
    return lerNvidiaSmi(saida);
  } catch {
    // Sem nvidia-smi: sem placa NVIDIA, ou sem driver. As duas dão em CPU.
    return [];
  }
}

export async function espacoLivre(pasta: string): Promise<number> {
  try {
    const info = await statfs(parse(pasta).root);
    return info.bavail * info.bsize;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Encerra o processo do PID guardado no arquivo — e tudo o que ele abriu —,
 * mas só se ele ainda for o programa esperado: o Windows reaproveita números
 * de processo, e um arquivo velho não pode fazer o ajudante matar um programa
 * qualquer da pessoa.
 */
export async function encerrarPeloArquivo(
  arquivoDoPid: string,
  imagemEsperada: string,
): Promise<boolean> {
  if (!existsSync(arquivoDoPid)) return false;
  const pid = Number(readFileSync(arquivoDoPid, "utf8").trim());
  // O próprio processo (reinstalar pelo menu da bandeja) fica com o arquivo:
  // é por ele que a próxima atualização encontra e fecha este ajudante.
  if (pid === process.pid) return false;
  rmSync(arquivoDoPid, { force: true });
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    const lista = await rodarELer("tasklist", [
      "/FI",
      `PID eq ${pid}`,
      "/FO",
      "CSV",
      "/NH",
    ]);
    if (!lista.toLowerCase().includes(imagemEsperada.toLowerCase())) return false;
  } catch {
    return false;
  }
  await rodar("taskkill", ["/PID", String(pid), "/T", "/F"]);
  registrar(`encerrado o processo ${pid} (${imagemEsperada})`);
  return true;
}

export function encerrarArvore(pid: number): Promise<number> {
  return rodar("taskkill", ["/PID", String(pid), "/T", "/F"]);
}

function pastaDoMenuIniciar(): string {
  return join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
}

/** Abrir pelo Menu Iniciar liga o ajudante na bandeja (ou avisa que já está ligado). */
export function criarAtalho(executavel: string): void {
  const ok = shell.writeShortcutLink(
    join(pastaDoMenuIniciar(), `${NOME_DO_PROGRAMA}.lnk`),
    {
      target: executavel,
      description: "Transcreve as suas consultas aqui, no seu computador.",
      icon: executavel,
      iconIndex: 0,
      appUserModelId: ID_DO_APLICATIVO,
    },
  );
  registrar(`atalho no Menu Iniciar: ${ok ? "criado" : "falhou"}`);
}

export function removerAtalho(): void {
  rmSync(join(pastaDoMenuIniciar(), `${NOME_DO_PROGRAMA}.lnk`), { force: true });
}

/** Aparece em Configurações → Aplicativos, com "Desinstalar" levando à nossa tela. */
export async function registrarNaListaDeProgramas(
  executavel: string,
  pasta: string,
  versao: string,
  tamanhoKb: number,
): Promise<void> {
  const valores: [string, string, string][] = [
    ["DisplayName", "REG_SZ", NOME_DO_PROGRAMA],
    ["DisplayVersion", "REG_SZ", versao],
    ["Publisher", "REG_SZ", "Consulta Viva"],
    ["DisplayIcon", "REG_SZ", executavel],
    ["InstallLocation", "REG_SZ", pasta],
    ["UninstallString", "REG_SZ", `"${executavel}" --desinstalar`],
    ["EstimatedSize", "REG_DWORD", String(tamanhoKb)],
    ["NoModify", "REG_DWORD", "1"],
    ["NoRepair", "REG_DWORD", "1"],
  ];
  for (const [nome, tipo, valor] of valores) {
    await rodar("reg", [
      "add",
      CHAVE_DE_DESINSTALACAO,
      "/v",
      nome,
      "/t",
      tipo,
      "/d",
      valor,
      "/f",
    ]);
  }
}

export async function removerDaListaDeProgramas(): Promise<void> {
  await rodar("reg", ["delete", CHAVE_DE_DESINSTALACAO, "/f"]);
}

/** Liga com o Windows, direto na bandeja, sem abrir janela. */
export function iniciarComOWindows(ligado: boolean, executavel: string): void {
  app.setLoginItemSettings({
    openAtLogin: ligado,
    path: executavel,
    args: ["--bandeja"],
  });
}

export function iniciaComOWindows(executavel: string): boolean {
  return app.getLoginItemSettings({ path: executavel, args: ["--bandeja"] })
    .openAtLogin;
}

export const IMAGEM_DO_AJUDANTE = NOME_DO_EXECUTAVEL;
export const IMAGEM_DO_MOTOR = "python.exe";
