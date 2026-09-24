import { describe, expect, it } from "vitest";

import { assinar, createS3Storage } from "./s3";

/**
 * Os exemplos publicados pela AWS na documentação da Signature V4 para S3.
 * Se a assinatura divergir de qualquer um, o armazenamento em produção
 * responde 403 a tudo — e o upload de uma consulta falha no fim.
 */
const AWS = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};
const VAZIO = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function assinatura(authorization: string): string {
  return /Signature=([0-9a-f]+)/.exec(authorization)?.[1] ?? "";
}

describe("assinatura AWS V4 — exemplos oficiais", () => {
  it("GET de objeto, com Range", () => {
    const auth = assinar(
      {
        metodo: "GET",
        url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
        cabecalhos: {
          host: "examplebucket.s3.amazonaws.com",
          range: "bytes=0-9",
          "x-amz-content-sha256": VAZIO,
          "x-amz-date": "20130524T000000Z",
        },
        hashDoCorpo: VAZIO,
      },
      AWS,
    );
    expect(assinatura(auth)).toBe(
      "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(auth).toContain(
      "Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request",
    );
    expect(auth).toContain("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date");
  });

  it("PUT de objeto com caractere especial no nome", () => {
    const hash = "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072";
    const auth = assinar(
      {
        metodo: "PUT",
        url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
        cabecalhos: {
          date: "Fri, 24 May 2013 00:00:00 GMT",
          host: "examplebucket.s3.amazonaws.com",
          "x-amz-content-sha256": hash,
          "x-amz-date": "20130524T000000Z",
          "x-amz-storage-class": "REDUCED_REDUNDANCY",
        },
        hashDoCorpo: hash,
      },
      AWS,
    );
    expect(assinatura(auth)).toBe(
      "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    );
  });

  it("listagem com parâmetros na consulta", () => {
    const auth = assinar(
      {
        metodo: "GET",
        url: new URL("https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J"),
        cabecalhos: {
          host: "examplebucket.s3.amazonaws.com",
          "x-amz-content-sha256": VAZIO,
          "x-amz-date": "20130524T000000Z",
        },
        hashDoCorpo: VAZIO,
      },
      AWS,
    );
    expect(assinatura(auth)).toBe(
      "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
    );
  });
});

/** Um S3 de mentira, em memória — o suficiente para o contrato do armazenamento. */
function s3Falso(itensPorPagina = 1000) {
  const objetos = new Map<string, Uint8Array<ArrayBuffer>>();
  type Corpo = ConstructorParameters<typeof Response>[0];
  const pedidos: { metodo: string; caminho: string; consulta: string }[] = [];
  const fetchFalso = async (
    entrada: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    const url = new URL(String(entrada));
    const metodo = init?.method ?? "GET";
    pedidos.push({ metodo, caminho: url.pathname, consulta: url.search });
    if (
      !new Headers(init?.headers).get("authorization")?.startsWith("AWS4-HMAC-SHA256")
    ) {
      return new Response(null, { status: 403 });
    }
    const prefixo = "/storage/v1/s3/gravacoes";
    const chave = decodeURIComponent(url.pathname.slice(prefixo.length + 1));
    if (url.searchParams.get("list-type") === "2") {
      const p = url.searchParams.get("prefix") ?? "";
      const todas = [...objetos.keys()].filter((k) => k.startsWith(p)).sort();
      const inicio = Number(url.searchParams.get("continuation-token") ?? "0");
      const pagina = todas.slice(inicio, inicio + itensPorPagina);
      const mais = inicio + itensPorPagina < todas.length;
      const xml =
        `<ListBucketResult>${pagina.map((k) => `<Contents><Key>${k.replace(/&/g, "&amp;")}</Key></Contents>`).join("")}` +
        `<IsTruncated>${mais}</IsTruncated>` +
        (mais
          ? `<NextContinuationToken>${inicio + itensPorPagina}</NextContinuationToken>`
          : "") +
        `</ListBucketResult>`;
      return new Response(xml, { status: 200 });
    }
    if (metodo === "PUT") {
      objetos.set(
        chave,
        new Uint8Array(await new Response(init?.body as Corpo).arrayBuffer()),
      );
      return new Response(null, { status: 200 });
    }
    const obj = objetos.get(chave);
    if (metodo === "DELETE") {
      objetos.delete(chave);
      return new Response(null, { status: 204 });
    }
    if (obj === undefined) {
      return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
    }
    return new Response(metodo === "HEAD" ? null : (obj as Corpo), { status: 200 });
  };
  return { objetos, pedidos, fetch: fetchFalso as typeof fetch };
}

const CFG = {
  endpoint: "https://projeto.storage.supabase.co/storage/v1/s3",
  region: "sa-east-1",
  accessKeyId: "chave",
  secretAccessKey: "segredo",
  bucket: "gravacoes",
};
const bytes = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;

describe("armazenamento S3", () => {
  it("grava e lê de volta os mesmos bytes, no caminho do bucket", async () => {
    const falso = s3Falso();
    const s = createS3Storage(CFG, falso.fetch);
    await s.put("prof-1/sess-1.wav", bytes("audio"));
    expect(new TextDecoder().decode(await s.get("prof-1/sess-1.wav"))).toBe("audio");
    expect(falso.pedidos[0]?.caminho).toBe(
      "/storage/v1/s3/gravacoes/prof-1/sess-1.wav",
    );
  });

  it("exists diz a verdade; remove é idempotente", async () => {
    const s = createS3Storage(CFG, s3Falso().fetch);
    await s.put("a/b.wav", bytes("x"));
    expect(await s.exists("a/b.wav")).toBe(true);
    await s.remove("a/b.wav");
    expect(await s.exists("a/b.wav")).toBe(false);
    await expect(s.remove("a/b.wav")).resolves.toBeUndefined();
  });

  it("ler o que não existe é erro, como no disco", async () => {
    const s = createS3Storage(CFG, s3Falso().fetch);
    await expect(s.get("nada.wav")).rejects.toThrow(/404 NoSuchKey/);
  });

  // O disco lista PASTAS. Se o S3 listasse prefixos de texto, apagar os
  // pedaços da sessão `abc` levaria junto os da sessão `abcdef`.
  it("lista o prefixo como pasta, em ordem", async () => {
    const s = createS3Storage(CFG, s3Falso().fetch);
    await s.put("p/partes/abc/00001", bytes("1"));
    await s.put("p/partes/abc/00000", bytes("0"));
    await s.put("p/partes/abc/segundo-microfone/00000", bytes("s"));
    await s.put("p/partes/abcdef/00000", bytes("outra"));
    expect(await s.list("p/partes/abc")).toEqual([
      "p/partes/abc/00000",
      "p/partes/abc/00001",
      "p/partes/abc/segundo-microfone/00000",
    ]);
    expect(await s.list("p/partes/nenhuma")).toEqual([]);
  });

  it("segue a paginação até o fim", async () => {
    const s = createS3Storage(CFG, s3Falso(2).fetch);
    for (let i = 0; i < 5; i++) await s.put(`p/x/${i}`, bytes(String(i)));
    expect(await s.list("p/x")).toHaveLength(5);
  });

  it("recusa chaves que escapariam da listagem", async () => {
    const s = createS3Storage(CFG, s3Falso().fetch);
    for (const ruim of ["", "/abs", "a/../b", "a//b", "a\\b"]) {
      await expect(s.put(ruim, bytes("x"))).rejects.toThrow(/inválida/);
    }
  });
});
