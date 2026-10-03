/**
 * Onde cada coisa mora no computador da pessoa.
 *
 * Tudo por usuário (`%LOCALAPPDATA%`): instalar não pede senha de
 * administrador, e desinstalar não deixa nada para outras contas do Windows.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { app } from "electron";

/** O motor do ajudante. Diferente da do Docker (8001): os dois nunca disputam porta. */
export const PORTA_DO_MOTOR = 8765;
/** Onde o motor do Docker responde, quando está ligado neste computador. */
export const PORTA_DO_DOCKER = 8001;
export const NOME_DO_EXECUTAVEL = "Consulta Viva Ajudante.exe";
export const NOME_DO_PROGRAMA = "Consulta Viva Ajudante";
/**
 * A identidade do programa para o Windows (o `appId` do electron-builder.yml):
 * agrupa os avisos ao lado do relógio e dá nome fixo à entrada de "iniciar
 * com o Windows" — o arquivo baixado e o instalado precisam usar a mesma.
 */
export const ID_DO_APLICATIVO = "br.com.consultaviva.ajudante";
export const SITE = "https://clinical-scribe-ai-web.vercel.app";

/**
 * O site com que o ajudante conversa. `AJUDANTE_SITE` troca — para testar
 * contra o site rodando no próprio computador (`http://localhost:3005`).
 */
export function enderecoDoSite(): string {
  return (process.env["AJUDANTE_SITE"]?.trim() || SITE).replace(/\/+$/, "");
}

/** O motor deste ajudante, no próprio computador. */
export function enderecoDoMotor(): string {
  return `http://127.0.0.1:${PORTA_DO_MOTOR}`;
}

export function caminhos() {
  const local = process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
  const programa = join(local, "Programs", NOME_DO_PROGRAMA);
  const dados = join(local, "ConsultaViva", "Ajudante");
  const venv = join(dados, "motor", "venv");
  const modelos = join(dados, "modelos");
  // A impressão vocal mora dentro da pasta do pyannote: ele escolhe como
  // carregar um modelo pelo caminho, e precisa ver "pyannote" nele.
  const separacao = join(modelos, "pyannote");
  return {
    programa,
    executavelInstalado: join(programa, NOME_DO_EXECUTAVEL),
    dados,
    python: join(dados, "python"),
    venv,
    pythonDoMotor: join(venv, "Scripts", "python.exe"),
    codigo: join(dados, "motor", "codigo"),
    modelos,
    whisper: join(modelos, "whisper", "large-v3"),
    separacao,
    configDaSeparacao: join(separacao, "config.yaml"),
    impressaoVocal: join(separacao, "wespeaker-voxceleb-resnet34-LM"),
    cache: join(dados, "cache"),
    temp: join(dados, "temp"),
    logs: join(dados, "logs"),
    estado: join(dados, "estado.json"),
    /** O token da conta conectada, cifrado pelo Windows (DPAPI). */
    conta: join(dados, "conta.bin"),
    pidDoMotor: join(dados, "motor.pid"),
    pidDoAjudante: join(dados, "ajudante.pid"),
  };
}

export type Caminhos = ReturnType<typeof caminhos>;

/** Os recursos que viajam com o programa: uv, código do motor, modelos, fonte. */
export function recursos(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "recursos")
    : join(app.getAppPath(), "recursos");
}
