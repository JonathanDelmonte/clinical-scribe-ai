import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { authConfig } from "../auth/config";
import { storage } from "../storage";

/**
 * Links para o ajudante ler e gravar UM arquivo, por pouco tempo, sem nunca
 * receber a chave do armazenamento. Ver ADR-0005.
 *
 * No S3 (produção) o link é do próprio armazenamento, assinado com a
 * Signature V4: o áudio vai direto do computador da pessoa ao bucket, sem
 * passar por uma função do site (que nem aceitaria um corpo desse tamanho).
 *
 * No disco local (desenvolvimento) não há quem assine — então assina o site,
 * e a rota `/api/ajudante/arquivos` confere. A chave é derivada do segredo da
 * sessão, por propósito, como a dos convites: um link de arquivo nunca vale
 * como outra coisa.
 */

/** Uma hora: o tempo de baixar uma consulta longa numa conexão lenta. */
export const VALIDADE_DO_LINK_SEGUNDOS = 60 * 60;

type Metodo = "GET" | "PUT";

function chaveDosLinks(): Buffer {
  return createHmac("sha256", authConfig.secret)
    .update("consulta-viva/ajudante/arquivos/v1")
    .digest();
}

function assinatura(arquivo: string, metodo: Metodo, exp: number): string {
  return createHmac("sha256", chaveDosLinks())
    .update(`${metodo}\n${arquivo}\n${exp}`)
    .digest("base64url");
}

export function linkDoArquivo(origem: string, arquivo: string, metodo: Metodo): string {
  if (storage.urlAssinada !== undefined) {
    return storage.urlAssinada(arquivo, metodo, VALIDADE_DO_LINK_SEGUNDOS);
  }
  const exp = Math.floor(Date.now() / 1000) + VALIDADE_DO_LINK_SEGUNDOS;
  const url = new URL("/api/ajudante/arquivos", origem);
  url.searchParams.set("c", arquivo);
  url.searchParams.set("m", metodo);
  url.searchParams.set("e", String(exp));
  url.searchParams.set("a", assinatura(arquivo, metodo, exp));
  return url.toString();
}

/** A chave do arquivo, se o link é válido para este método; `null` se não. */
export function conferirLink(
  parametros: URLSearchParams,
  metodo: Metodo,
  agoraSegundos: number = Math.floor(Date.now() / 1000),
): string | null {
  const arquivo = parametros.get("c");
  const exp = Number(parametros.get("e"));
  if (arquivo === null || parametros.get("m") !== metodo) return null;
  if (!Number.isInteger(exp) || exp < agoraSegundos) return null;
  const recebida = Buffer.from(parametros.get("a") ?? "", "utf8");
  const esperada = Buffer.from(assinatura(arquivo, metodo, exp), "utf8");
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) {
    return null;
  }
  return arquivo;
}
