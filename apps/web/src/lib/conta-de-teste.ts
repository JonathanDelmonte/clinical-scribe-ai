/**
 * A conta de desenvolvimento — e só em desenvolvimento.
 *
 * ## Por que a condição fica AQUI, e não na página que usa o botão
 *
 * `process.env.NODE_ENV` é trocado por um texto fixo na hora do build. Em
 * produção, esta linha vira `"production" === "production" ? null : {...}`, o
 * minificador resolve a conta e **apaga o objeto inteiro** — e-mail e senha
 * junto. A credencial não chega ao pacote que vai para o navegador.
 *
 * Se a condição ficasse na página ("só renderize o botão em dev"), o botão
 * sumiria da tela mas este módulo continuaria importado — e a senha continuaria
 * dentro do JavaScript de produção, legível por qualquer um que abrisse as
 * ferramentas do navegador.
 *
 * A mesma senha está em `packages/db/src/seed.ts` e no `atalhos/README.md`. Ela
 * é pública de propósito: a conta só existe em banco local. O teste em
 * `conta-de-teste.test.ts` confere que as duas cópias não divergiram.
 */
export const CONTA_DE_TESTE =
  process.env.NODE_ENV === "production"
    ? null
    : { email: "ana@consultaviva.local", senha: "consulta-viva-dev" };
