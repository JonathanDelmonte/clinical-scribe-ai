import { describe, expect, it } from "vitest";

import {
  arquivosDaGravacao,
  ehManifestoDePartes,
  LIMITE_ARQUIVO_UNICO_BYTES,
  sessionPartsManifestKey,
  secondChannelKey,
  secondChannelPartsManifestKey,
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
    ).toEqual(["p/s.wav", "p/s-segundo-microfone.cve", "p/s.partes.json"]);
  });

  it("sessão só com o principal", () => {
    expect(
      arquivosDaGravacao({ audioPath: "p/s.m4a", secondChannelPath: null }),
    ).toEqual(["p/s.m4a", "p/s.partes.json"]);
    expect(arquivosDaGravacao({ audioPath: "p/s.wav" })).toEqual([
      "p/s.wav",
      "p/s.partes.json",
    ]);
  });

  // O áudio já montado, a transcrição que falhou: os pedaços esperam, e o
  // manifesto deles precisa sair junto com a sessão.
  it("o manifesto sai junto — o mesmo que o worker e o site usam", () => {
    const audio = sessionAudioKey("dono", "sessao", "m4a");
    expect(arquivosDaGravacao({ audioPath: audio })).toContain(
      sessionPartsManifestKey("dono", "sessao"),
    );
    // Ainda em pedaços, o manifesto É o áudio da sessão: aparece uma vez só.
    const manifesto = sessionPartsManifestKey("dono", "sessao");
    expect(arquivosDaGravacao({ audioPath: manifesto })).toEqual([manifesto]);
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

  it("o manifesto do original fica sob o dono, fora da pasta de pedaços", () => {
    const manifesto = secondChannelPartsManifestKey("dono", "sessao");
    expect(manifesto).toBe("dono/sessao-segundo-microfone.partes.json");
    expect(manifesto).not.toContain("/partes/");
    expect(ehManifestoDePartes(manifesto)).toBe(true);
    // Nem a medida nem o manifesto do áudio principal: são três arquivos.
    expect(manifesto).not.toBe(secondChannelKey("dono", "sessao"));
    expect(manifesto).not.toBe(sessionPartsManifestKey("dono", "sessao"));
  });
});

describe("o manifesto de pedaços", () => {
  it("fica sob o dono, fora da pasta de pedaços, e é reconhecível", () => {
    const m = sessionPartsManifestKey("dono", "sessao");
    expect(m).toBe("dono/sessao.partes.json");
    expect(ehManifestoDePartes(m)).toBe(true);
    expect(ehManifestoDePartes(sessionAudioKey("dono", "sessao", "wav"))).toBe(false);
  });

  // Folga abaixo dos 50 MB por arquivo do Supabase gratuito.
  it("o arquivo único fica abaixo do limite do armazenamento gratuito", () => {
    expect(LIMITE_ARQUIVO_UNICO_BYTES).toBeLessThan(50 * 1024 * 1024);
  });
});
