import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CONTA_DE_TESTE } from "./conta-de-teste";

/**
 * A mesma credencial mora em três lugares, e eles precisam concordar.
 *
 * O seed CRIA a conta, este módulo a USA no botão, o README a MOSTRA para quem
 * lê. Se o seed mudar a senha e ninguém lembrar deste arquivo, o sintoma é "o
 * botão de teste parou de funcionar" — sem erro nenhum que aponte o porquê.
 *
 * Os arquivos são lidos como texto, e o seed NÃO é importado: importá-lo o
 * executaria, e ele grava no banco ao ser carregado.
 */
function texto(caminhoRelativo: string): string {
  return readFileSync(fileURLToPath(new URL(caminhoRelativo, import.meta.url)), "utf8");
}

describe("conta de teste", () => {
  it("existe fora de produção", () => {
    // O vitest roda com NODE_ENV=test; o botão precisa funcionar aqui e no dev.
    expect(CONTA_DE_TESTE).not.toBeNull();
  });

  it("usa a mesma senha que o seed grava", () => {
    const seed = texto("../../../../packages/db/src/seed.ts");
    const senhaDoSeed = /DEV_PASSWORD\s*=\s*"([^"]+)"/.exec(seed)?.[1];
    expect(senhaDoSeed).toBeDefined();
    expect(CONTA_DE_TESTE?.senha).toBe(senhaDoSeed);
  });

  it("usa um e-mail que o seed cria", () => {
    const seed = texto("../../../../packages/db/src/seed.ts");
    expect(seed).toContain(`email: "${CONTA_DE_TESTE?.email}"`);
  });

  it("o README dos atalhos mostra a mesma credencial", () => {
    const readme = texto("../../../../atalhos/README.md");
    expect(readme).toContain(CONTA_DE_TESTE?.email);
    expect(readme).toContain(CONTA_DE_TESTE?.senha);
  });

  // A propriedade que torna seguro ter isto no código: o domínio `.local` não
  // resolve na internet, então esta conta não pode existir num servidor de
  // verdade com e-mail que alguém receba.
  it("o e-mail é de um domínio que não existe na internet", () => {
    expect(CONTA_DE_TESTE?.email.endsWith(".local")).toBe(true);
  });
});
