/**
 * O registro do ajudante — num arquivo, nunca numa janela de comando.
 *
 * É o que se manda quando algo dá errado ("Copiar detalhes" na tela de erro).
 * Nunca recebe áudio, texto de consulta nem chave: só o que o programa fez.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import { caminhos } from "./caminhos";

const LIMITE_BYTES = 5 * 1024 * 1024;
const recentes: string[] = [];
/** Depois de desinstalar, nenhuma linha pode recriar a pasta que acabou de sair. */
let gravando = true;

export function pararDeGravar(): void {
  gravando = false;
}

function arquivo(nome: string): string {
  const pasta = caminhos().logs;
  mkdirSync(pasta, { recursive: true });
  const caminho = join(pasta, nome);
  try {
    if (statSync(caminho).size > LIMITE_BYTES) renameSync(caminho, `${caminho}.1`);
  } catch {
    // ainda não existe
  }
  return caminho;
}

export function registrar(mensagem: string, arquivoDoRegistro = "ajudante.log"): void {
  const linha = `${new Date().toISOString()} ${mensagem}`;
  recentes.push(linha);
  if (recentes.length > 300) recentes.shift();
  if (!gravando) return;
  try {
    appendFileSync(arquivo(arquivoDoRegistro), `${linha}\n`, "utf8");
  } catch {
    // Registro que falha não pode derrubar a instalação.
  }
}

/** As últimas linhas, para "Copiar detalhes". */
export function ultimasLinhas(): string {
  return recentes.join("\n");
}
