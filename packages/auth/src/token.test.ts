import { describe, expect, it } from "vitest";

import { shouldRenew, signSessionToken, verifySessionToken } from "./token";

const SEGREDO = "segredo-de-teste-suficientemente-longo";
const AGORA = 1_700_000_000;

describe("token de sessão", () => {
  it("devolve as reivindicações que assinou", () => {
    const token = signSessionToken({ sub: "abc", exp: AGORA + 60 }, SEGREDO);
    expect(verifySessionToken(token, SEGREDO, AGORA)).toEqual({
      sub: "abc",
      exp: AGORA + 60,
    });
  });

  it("recusa token assinado com outro segredo", () => {
    const token = signSessionToken({ sub: "abc", exp: AGORA + 60 }, "outro segredo");
    expect(verifySessionToken(token, SEGREDO, AGORA)).toBeNull();
  });

  /**
   * O ataque óbvio: trocar o `sub` para o de outro profissional e torcer para
   * que ninguém confira a assinatura. Se este teste passar a falhar, cada
   * usuário pode ler o prontuário de qualquer outro.
   */
  it("recusa payload adulterado que mantém a assinatura original", () => {
    const token = signSessionToken({ sub: "ana", exp: AGORA + 60 }, SEGREDO);
    const [, assinatura] = token.split(".");
    const forjado = Buffer.from(
      JSON.stringify({ sub: "bruno", exp: AGORA + 60 }),
      "utf8",
    ).toString("base64url");

    expect(verifySessionToken(`${forjado}.${assinatura}`, SEGREDO, AGORA)).toBeNull();
  });

  it("recusa token expirado", () => {
    const token = signSessionToken({ sub: "abc", exp: AGORA - 1 }, SEGREDO);
    expect(verifySessionToken(token, SEGREDO, AGORA)).toBeNull();
  });

  it("recusa token sem assinatura, vazio ou ausente", () => {
    expect(verifySessionToken(undefined, SEGREDO, AGORA)).toBeNull();
    expect(verifySessionToken("", SEGREDO, AGORA)).toBeNull();
    expect(verifySessionToken("semponto", SEGREDO, AGORA)).toBeNull();
    expect(verifySessionToken(".assinatura", SEGREDO, AGORA)).toBeNull();
  });

  it("recusa payload que não é JSON de reivindicações", () => {
    const payload = Buffer.from("nem json", "utf8").toString("base64url");
    const token = signSessionToken({ sub: "x", exp: AGORA + 60 }, SEGREDO);
    const [, assinaturaValida] = token.split(".");
    // Assinatura de outro payload: cai antes por integridade.
    expect(
      verifySessionToken(`${payload}.${assinaturaValida}`, SEGREDO, AGORA),
    ).toBeNull();
  });

  it("recusa reivindicações sem sub ou com exp que não é número", () => {
    const semSub = Buffer.from(JSON.stringify({ exp: AGORA + 60 }), "utf8").toString(
      "base64url",
    );
    const expTexto = Buffer.from(
      JSON.stringify({ sub: "a", exp: "amanhã" }),
      "utf8",
    ).toString("base64url");

    for (const payload of [semSub, expTexto]) {
      const assinado = signSessionToken({ sub: "a", exp: AGORA + 60 }, SEGREDO);
      const secreto = assinado.split(".")[1];
      expect(verifySessionToken(`${payload}.${secreto}`, SEGREDO, AGORA)).toBeNull();
    }
  });
});

describe("renovação", () => {
  const TTL = 3600;

  it("não renova na primeira metade da validade", () => {
    expect(shouldRenew({ sub: "a", exp: AGORA + 3000 }, TTL, AGORA)).toBe(false);
  });

  it("renova na segunda metade", () => {
    expect(shouldRenew({ sub: "a", exp: AGORA + 600 }, TTL, AGORA)).toBe(true);
  });
});
