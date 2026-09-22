/**
 * O token de sessão — um cookie que o servidor assina e o cliente só carrega.
 *
 * ## Por que assinar em vez de guardar a sessão no banco
 *
 * Uma tabela de sessões daria revogação imediata, e é para onde isto vai
 * quando houver motivo. Hoje custaria uma consulta ao banco em CADA requisição
 * — inclusive nas que não tocam em dado nenhum — para resolver um problema que
 * ainda não existe: não há painel de "encerrar sessões", não há suporte que
 * derrube o acesso de alguém, não há usuário.
 *
 * O preço dessa escolha está escrito aqui para quem for mudá-la: **um token
 * roubado vale até expirar.** Sair da aplicação apaga o cookie do navegador, e
 * é isso; não invalida uma cópia que alguém tenha levado. É por isso que a
 * validade é curta e não infinita.
 *
 * ## O que NÃO vai dentro
 *
 * Só `sub` (o `auth_user_id`) e `exp`. Nada de nome, e-mail, plano ou cargo:
 * o conteúdo de um token assinado é legível por qualquer um que o tenha — a
 * assinatura prova que não foi ALTERADO, não esconde o que está escrito. Cargo
 * e plano, além disso, mudam; um token é uma fotografia, e autorização
 * decidida por fotografia é autorização defasada. Quem decide vem do banco, a
 * cada requisição.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionClaims {
  /** `auth_user_id` do profissional. */
  readonly sub: string;
  /** Expiração, em segundos desde a época. */
  readonly exp: number;
}

function base64url(data: Buffer): string {
  return data.toString("base64url");
}

function sign(payload: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(payload).digest());
}

/** Assina as reivindicações e devolve o valor que vai no cookie. */
export function signSessionToken(claims: SessionClaims, secret: string): string {
  const payload = base64url(Buffer.from(JSON.stringify(claims), "utf8"));
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Confere assinatura e validade. Devolve `null` para qualquer problema.
 *
 * `null` e não exceção, e sem distinguir "assinatura inválida" de "expirado":
 * quem recebe a resposta é quem apresentou o token, e a diferença entre esses
 * dois casos só interessa a quem está tentando forjar um.
 */
export function verifySessionToken(
  token: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SessionClaims | null {
  if (token === undefined || token === "") return null;

  const corte = token.indexOf(".");
  if (corte <= 0) return null;

  const payload = token.slice(0, corte);
  const assinatura = token.slice(corte + 1);
  const esperada = sign(payload, secret);

  // Comparação em tempo constante. Um `===` vazaria, pelo tempo de resposta,
  // quantos bytes iniciais o atacante acertou — que é o suficiente para
  // descobrir a assinatura byte a byte, sem nunca conhecer o segredo.
  const a = Buffer.from(assinatura, "utf8");
  const b = Buffer.from(esperada, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof claims !== "object" || claims === null) return null;
  const { sub, exp } = claims as Record<string, unknown>;

  if (typeof sub !== "string" || sub === "") return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  if (exp <= nowSeconds) return null;

  return { sub, exp };
}

/**
 * O token está na segunda metade da validade?
 *
 * Renovar cedo demais reescreve o cookie a cada clique; renovar tarde demais
 * desloga quem estava usando o produto. A metade é o ponto em que a renovação
 * é rara e ainda sobra tempo para ela acontecer.
 */
export function shouldRenew(
  claims: SessionClaims,
  ttlSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  return claims.exp - nowSeconds < ttlSeconds / 2;
}
