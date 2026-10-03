import { describe, expect, it } from "vitest";

import {
  assinarConvite,
  desafioDoVerificador,
  hashDoTokenDoAjudante,
  lerConvite,
  novoTokenDoAjudante,
  pareceTokenDoAjudante,
  VALIDADE_DO_CONVITE_SEGUNDOS,
} from "./ajudante";
import { signSessionToken, verifySessionToken } from "./token";

const SEGREDO = "segredo-de-teste-com-tamanho-suficiente-para-hmac";
const AGORA = 1_800_000_000;
const verificador = "um-verificador-que-so-o-ajudante-conhece-0123456789";

function convite() {
  return assinarConvite(
    {
      sub: "11111111-1111-1111-1111-111111111111",
      desafio: desafioDoVerificador(verificador),
      nome: "CONSULTORIO-1",
    },
    SEGREDO,
    AGORA,
  );
}

describe("o token do ajudante", () => {
  it("é único, tem a cara certa, e o banco guarda só o hash", () => {
    const a = novoTokenDoAjudante();
    const b = novoTokenDoAjudante();
    expect(a).not.toBe(b);
    expect(pareceTokenDoAjudante(a)).toBe(true);
    expect(pareceTokenDoAjudante("qualquer coisa")).toBe(false);
    expect(hashDoTokenDoAjudante(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDoTokenDoAjudante(a)).not.toContain(a);
  });
});

describe("o convite de conexão", () => {
  it("com o verificador certo, dentro do prazo: abre", () => {
    const lido = lerConvite(convite(), verificador, SEGREDO, AGORA + 60);
    expect(lido).toMatchObject({
      sub: "11111111-1111-1111-1111-111111111111",
      nome: "CONSULTORIO-1",
    });
    expect(lido?.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("sem o verificador (PKCE), o convite interceptado não serve", () => {
    expect(lerConvite(convite(), "outro-verificador", SEGREDO, AGORA + 60)).toBeNull();
  });

  it("vencido, adulterado ou de outro segredo: não abre", () => {
    const c = convite();
    expect(
      lerConvite(c, verificador, SEGREDO, AGORA + VALIDADE_DO_CONVITE_SEGUNDOS + 1),
    ).toBeNull();
    expect(lerConvite(`${c}x`, verificador, SEGREDO, AGORA + 60)).toBeNull();
    expect(lerConvite(c, verificador, "outro-segredo", AGORA + 60)).toBeNull();
    expect(lerConvite("sem-ponto", verificador, SEGREDO, AGORA)).toBeNull();
  });

  it("um convite NÃO é um cookie de sessão, e vice-versa (chaves separadas)", () => {
    // O convite tem `sub` e `exp`, como a sessão. Com a mesma chave, ele
    // entraria na conta por cinco minutos.
    expect(verifySessionToken(convite(), SEGREDO, AGORA + 60)).toBeNull();
    const sessao = signSessionToken(
      { sub: "11111111-1111-1111-1111-111111111111", exp: AGORA + 3600 },
      SEGREDO,
    );
    expect(lerConvite(sessao, verificador, SEGREDO, AGORA + 60)).toBeNull();
  });

  it("cada convite tem o seu nonce: o mesmo não conecta dois computadores", () => {
    const a = lerConvite(convite(), verificador, SEGREDO, AGORA);
    const b = lerConvite(convite(), verificador, SEGREDO, AGORA);
    expect(a?.nonce).not.toBe(b?.nonce);
  });
});
