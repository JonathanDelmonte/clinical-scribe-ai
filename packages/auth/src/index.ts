/**
 * Primitivas de autenticação — puras, sem banco e sem rede.
 *
 * Vive num pacote próprio porque tem dois consumidores que não podem importar
 * um do outro: a aplicação web, que confere senha e assina sessão, e o
 * `pnpm db:seed`, que precisa gravar a senha dos usuários de desenvolvimento
 * no mesmo formato. Duplicar a derivação nos dois lados daria certo até o dia
 * em que um dos lados mudasse o custo do scrypt — e o sintoma seria "o seed
 * roda, mas ninguém consegue entrar".
 *
 * Não depende de `@scribe/core` nem de `@scribe/db` de propósito: autenticação
 * é anterior a domínio e a persistência.
 */

export {
  hashDeIsca,
  hashPassword,
  senhaInvalida,
  SENHA_MAXIMA,
  SENHA_MINIMA,
  verifyPassword,
} from "./password";

export type { SessionClaims } from "./token";
export { shouldRenew, signSessionToken, verifySessionToken } from "./token";
