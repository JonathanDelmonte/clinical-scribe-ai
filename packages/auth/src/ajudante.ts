/**
 * A conexão do ajudante (o programa do Windows) à conta de um profissional.
 * Ver ADR-0005.
 *
 * O desenho é o dos aplicativos que "entram com o Google": quem diz "sim, este
 * computador é meu" é o profissional, no navegador, onde ele já entrou com a
 * própria senha. O ajudante nunca vê a senha, e o site nunca vê o computador.
 *
 *   1. O ajudante abre o navegador em /ajudante/conectar, com um DESAFIO —
 *      o SHA-256 de um segredo que só ele guarda (o verificador).
 *   2. A pessoa confirma; o site devolve ao ajudante, pelo endereço local do
 *      próprio computador (127.0.0.1), um CONVITE assinado que vale cinco
 *      minutos.
 *   3. O ajudante troca convite + verificador por um TOKEN só dele. Quem
 *      interceptasse o convite no caminho não teria o verificador (PKCE,
 *      RFC 7636): o convite sozinho não conecta ninguém.
 *
 * O token fica no ajudante, cifrado pelo Windows; no banco fica só o SHA-256
 * dele, como uma senha.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIXO_DO_TOKEN = "cvaj_";

/** Um token novo para um computador conectado. Aparece uma vez, na conexão. */
export function novoTokenDoAjudante(): string {
  return `${PREFIXO_DO_TOKEN}${randomBytes(32).toString("base64url")}`;
}

/** O que fica no banco: o SHA-256 do token, em hexadecimal. */
export function hashDoTokenDoAjudante(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Um token tem a cara certa? Barra lixo antes de ir ao banco. */
export function pareceTokenDoAjudante(token: string): boolean {
  return /^cvaj_[A-Za-z0-9_-]{43}$/.test(token);
}

/** O desafio PKCE (S256): o SHA-256 do verificador, em base64url. */
export function desafioDoVerificador(verificador: string): string {
  return createHash("sha256").update(verificador, "utf8").digest("base64url");
}

export interface Convite {
  /** `auth_user_id` de quem confirmou a conexão. */
  readonly sub: string;
  /** O desafio que o ajudante mandou: só quem tem o verificador troca o convite. */
  readonly desafio: string;
  /** O nome do computador, como o ajudante o informou. */
  readonly nome: string;
  /** Único por convite: o mesmo convite não conecta dois computadores. */
  readonly nonce: string;
  /** Expiração, em segundos desde a época. */
  readonly exp: number;
}

/** Cinco minutos: o tempo de o navegador devolver o convite ao ajudante. */
export const VALIDADE_DO_CONVITE_SEGUNDOS = 5 * 60;

/**
 * A chave que assina convites é DERIVADA do segredo da sessão, e não ele
 * mesmo. Com a mesma chave, e o mesmo formato, um convite seria também um
 * cookie de sessão válido — e quem o interceptasse no caminho entraria na
 * conta por cinco minutos. Chaves separadas por propósito fecham isso.
 */
function chaveDosConvites(segredo: string): Buffer {
  return createHmac("sha256", segredo)
    .update("consulta-viva/ajudante/convite/v1")
    .digest();
}

function assinatura(payload: string, segredo: string): string {
  return createHmac("sha256", chaveDosConvites(segredo))
    .update(payload)
    .digest("base64url");
}

export function assinarConvite(
  dados: Omit<Convite, "nonce" | "exp">,
  segredo: string,
  agoraSegundos: number = Math.floor(Date.now() / 1000),
): string {
  const convite: Convite = {
    ...dados,
    nonce: randomBytes(16).toString("base64url"),
    exp: agoraSegundos + VALIDADE_DO_CONVITE_SEGUNDOS,
  };
  const payload = Buffer.from(JSON.stringify(convite), "utf8").toString("base64url");
  return `${payload}.${assinatura(payload, segredo)}`;
}

/**
 * Lê um convite e confere o verificador. `null` para qualquer problema —
 * assinatura, validade, formato ou verificador errado: quem chama não precisa
 * (e não deve) dizer ao outro lado qual deles foi.
 */
export function lerConvite(
  codigo: string,
  verificador: string,
  segredo: string,
  agoraSegundos: number = Math.floor(Date.now() / 1000),
): Convite | null {
  const corte = codigo.indexOf(".");
  if (corte <= 0) return null;
  const payload = codigo.slice(0, corte);
  const recebida = Buffer.from(codigo.slice(corte + 1), "utf8");
  const esperada = Buffer.from(assinatura(payload, segredo), "utf8");
  // Tempo constante, como na sessão: um `===` vazaria a assinatura byte a byte.
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) {
    return null;
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof bruto !== "object" || bruto === null) return null;
  const { sub, desafio, nome, nonce, exp } = bruto as Record<string, unknown>;
  if (
    typeof sub !== "string" ||
    typeof desafio !== "string" ||
    typeof nome !== "string" ||
    typeof nonce !== "string" ||
    typeof exp !== "number" ||
    !Number.isFinite(exp)
  ) {
    return null;
  }
  if (exp <= agoraSegundos) return null;

  const desafioDoVerificadorRecebido = Buffer.from(
    desafioDoVerificador(verificador),
    "utf8",
  );
  const desafioGuardado = Buffer.from(desafio, "utf8");
  if (
    desafioDoVerificadorRecebido.length !== desafioGuardado.length ||
    !timingSafeEqual(desafioDoVerificadorRecebido, desafioGuardado)
  ) {
    return null;
  }
  return { sub, desafio, nome, nonce, exp };
}
