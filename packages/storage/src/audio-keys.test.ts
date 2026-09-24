import { describe, expect, it } from "vitest";

import {
  arquivosDaGravacao,
  secondChannelKey,
  secondChannelOriginalKey,
  secondChannelPartKey,
  sessionAudioKey,
  sessionPartKey,
  sessionPartsPrefix,
} from "./index";

describe("arquivosDaGravacao", () => {
  it("lista o áudio principal e o segundo microfone", () => {
    expect(
      arquivosDaGravacao({
        audioPath: "p/s.wav",
        secondChannelPath: "p/s-segundo-microfone.cve",
      }),
    ).toEqual(["p/s.wav", "p/s-segundo-microfone.cve"]);
  });

  it("sessão só com o principal", () => {
    expect(
      arquivosDaGravacao({ audioPath: "p/s.wav", secondChannelPath: null }),
    ).toEqual(["p/s.wav"]);
    expect(arquivosDaGravacao({ audioPath: "p/s.wav" })).toEqual(["p/s.wav"]);
  });

  it("sessão sem gravação nenhuma", () => {
    expect(arquivosDaGravacao({ audioPath: null, secondChannelPath: null })).toEqual(
      [],
    );
  });

  // Chave vazia apagaria... o quê? Em alguns armazenamentos, a raiz. Nunca
  // pode chegar a um `remove`.
  it("ignora chave vazia", () => {
    expect(arquivosDaGravacao({ audioPath: "", secondChannelPath: "" })).toEqual([]);
  });
});

describe("secondChannelKey", () => {
  it("fica sob o mesmo dono e ao lado do áudio principal", () => {
    const principal = sessionAudioKey("dono", "sessao", "wav");
    const segundo = secondChannelKey("dono", "sessao");
    expect(segundo).toBe("dono/sessao-segundo-microfone.cve");
    expect(segundo.split("/")[0]).toBe(principal.split("/")[0]);
  });

  // O prefixo `partes/` é apagado inteiro depois de montar um upload. O
  // segundo microfone não pode morar embaixo dele.
  it("não cai na pasta de pedaços de upload", () => {
    expect(secondChannelKey("dono", "sessao")).not.toContain("/partes/");
  });
});

describe("o caminho de reserva do segundo microfone", () => {
  // Quem apaga a sessão apaga `sessionPartsPrefix` inteiro, e a listagem é por
  // pasta: os pedaços do segundo microfone precisam estar DENTRO dela.
  it("os pedaços ficam dentro da pasta de pedaços da sessão", () => {
    expect(
      secondChannelPartKey("dono", "sessao", 3).startsWith(
        `${sessionPartsPrefix("dono", "sessao")}/`,
      ),
    ).toBe(true);
    expect(secondChannelPartKey("dono", "sessao", 3)).toBe(
      "dono/partes/sessao/segundo-microfone/00003",
    );
  });

  it("não colide com os pedaços do áudio principal", () => {
    expect(secondChannelPartKey("dono", "sessao", 0)).not.toBe(
      sessionPartKey("dono", "sessao", 0),
    );
  });

  it("o original fica sob o dono, fora da pasta de pedaços", () => {
    const original = secondChannelOriginalKey("dono", "sessao", ".WMA");
    expect(original).toBe("dono/sessao-segundo-microfone-original.wma");
    expect(original).not.toContain("/partes/");
    expect(original).not.toBe(secondChannelKey("dono", "sessao"));
  });
});
