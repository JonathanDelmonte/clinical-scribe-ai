import { describe, expect, it } from "vitest";

import {
  ACCEPT_DE_AUDIO,
  EXTENSOES_ACEITAS,
  extensaoDoNome,
  MAX_AUDIO_BYTES,
  MAX_CORPO_BUFFERIZADO_BYTES,
} from "./audio";
import { TAMANHO_DA_PARTE } from "./recording/partes";

describe("extensão do nome do arquivo", () => {
  it.each([
    ["consulta.wav", "wav"],
    ["consulta.WAV", "wav"],
    ["áudio da consulta.m4a", "m4a"],
    ["gravação 12.03.2026.mp3", "mp3"],
    ["arquivo.tar.gz", "gz"],
  ])("%s → %s", (nome, esperado) => {
    expect(extensaoDoNome(nome)).toBe(esperado);
  });

  /**
   * Sem extensão, a resposta é `""` — e não um chute.
   *
   * O `extensionOf()` do armazenamento devolve `"webm"` nesse caso, que é a
   * suposição certa para dar nome a um arquivo em disco e a errada para
   * decidir se aceitamos o que a pessoa escolheu: um `.pdf` renomeado para
   * "consulta" entraria como webm e só quebraria lá no serviço de ASR.
   */
  it.each(["consulta", "", ".", "arquivo.", "consulta.extensaomuitolonga"])(
    "não chuta extensão para %o",
    (nome) => {
      expect(extensaoDoNome(nome)).toBe("");
      expect(EXTENSOES_ACEITAS.has(extensaoDoNome(nome))).toBe(false);
    },
  );
});

describe("o que o seletor de arquivos oferece", () => {
  /**
   * O `accept` do input e a lista que valida o envio precisam ser a mesma
   * lista. Quando divergem, o resultado é sempre o pior dos dois: ou a
   * pessoa não consegue escolher um arquivo que o servidor aceitaria, ou
   * escolhe um que ele vai recusar depois de subir.
   */
  it("oferece exatamente os formatos aceitos", () => {
    for (const extensao of EXTENSOES_ACEITAS) {
      expect(ACCEPT_DE_AUDIO).toContain(`.${extensao}`);
    }
  });
});

describe("tetos de corpo de requisição", () => {
  /**
   * ⚠️ A asserção que existe por causa de um bug real.
   *
   * O `proxy.ts` faz o Next bufferizar o corpo de toda requisição, e **acima
   * do teto ele corta o corpo sem devolver erro nenhum**. Um pedaço de áudio
   * maior que o buffer chegaria cortado e em silêncio — e viraria uma
   * consulta remontada com um buraco no meio, transcrita sem reclamação, com
   * um trecho da conversa simplesmente ausente da nota.
   *
   * Enquanto esta asserção passar, nenhum corpo que o produto envia chega
   * perto do teto.
   */
  it("um pedaço cabe no que o proxy consegue bufferizar", () => {
    expect(TAMANHO_DA_PARTE).toBeLessThan(MAX_CORPO_BUFFERIZADO_BYTES);
  });

  /**
   * E o áudio inteiro NÃO cabe — que é justamente por que ele sobe em
   * pedaços. Se um dia couber, o envio de uma viagem só volta a ser uma
   * opção; enquanto não couber, ele é uma armadilha.
   */
  it("o áudio inteiro não cabe numa viagem só", () => {
    expect(MAX_AUDIO_BYTES).toBeGreaterThan(MAX_CORPO_BUFFERIZADO_BYTES);
  });
});
