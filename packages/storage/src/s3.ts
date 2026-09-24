import { createHash, createHmac } from "node:crypto";

import type { AudioStorage } from "./index";

/**
 * Armazenamento em S3 — em produção, o Supabase Storage pelo protocolo S3.
 *
 * S3, e não a API própria do Supabase, por dois motivos:
 *
 * 1. **A credencial só abre arquivos.** A chave de acesso S3 do Supabase dá
 *    acesso ao Storage e a nada mais. A alternativa, a `service_role`, abre o
 *    banco inteiro ignorando o isolamento entre profissionais — e o checklist
 *    de segurança proíbe exatamente ela na aplicação web.
 * 2. **É um padrão, não um fornecedor.** O mesmo código fala com o Cloudflare
 *    R2, com o MinIO, com a AWS. Trocar de lugar é trocar quatro variáveis.
 *
 * A assinatura (AWS Signature V4) é feita aqui, com `node:crypto`, sem
 * dependência: são algumas dezenas de linhas, e o teste confere contra o
 * exemplo publicado pela própria AWS.
 */

export interface ConfiguracaoS3 {
  /** Ex.: https://<projeto>.storage.supabase.co/storage/v1/s3 */
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

const VAZIO_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256Hex(dados: string | Uint8Array): string {
  return createHash("sha256").update(dados).digest("hex");
}

function hmac(chave: string | Buffer, texto: string): Buffer {
  return createHmac("sha256", chave).update(texto, "utf8").digest();
}

/** A codificação de URI que a assinatura exige: tudo menos A-Z a-z 0-9 - _ . ~ */
function codificar(texto: string): string {
  return encodeURIComponent(texto).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function caminhoCodificado(caminho: string): string {
  return caminho.split("/").map(codificar).join("/");
}

export interface PedidoAssinavel {
  readonly metodo: string;
  readonly url: URL;
  readonly cabecalhos: Record<string, string>;
  readonly hashDoCorpo: string;
}

/**
 * Assina um pedido com AWS Signature V4 e devolve o cabeçalho Authorization.
 *
 * `cabecalhos` já precisa conter `host`, `x-amz-date` e `x-amz-content-sha256`
 * — tudo que estiver ali entra na assinatura.
 */
export function assinar(
  pedido: PedidoAssinavel,
  credenciais: Pick<ConfiguracaoS3, "accessKeyId" | "secretAccessKey" | "region">,
  servico = "s3",
): string {
  const data = pedido.cabecalhos["x-amz-date"];
  if (data === undefined) throw new Error("x-amz-date ausente");
  const dia = data.slice(0, 8);

  const nomes = Object.keys(pedido.cabecalhos)
    .map((n) => n.toLowerCase())
    .sort();
  const canonicos = nomes
    .map((n) => {
      const valor =
        Object.entries(pedido.cabecalhos).find(([k]) => k.toLowerCase() === n)?.[1] ??
        "";
      return `${n}:${valor.trim().replace(/\s+/g, " ")}\n`;
    })
    .join("");
  const assinados = nomes.join(";");

  const consulta = [...pedido.url.searchParams.entries()]
    .map(([k, v]) => [codificar(k), codificar(v)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const requisicaoCanonica = [
    pedido.metodo,
    // O caminho já chega codificado por `new URL` — mas com as regras da URL,
    // não as da assinatura. Decodifica e codifica de novo, do jeito dela.
    caminhoCodificado(decodeURIComponent(pedido.url.pathname)),
    consulta,
    canonicos,
    assinados,
    pedido.hashDoCorpo,
  ].join("\n");

  const escopo = `${dia}/${credenciais.region}/${servico}/aws4_request`;
  const textoParaAssinar = [
    "AWS4-HMAC-SHA256",
    data,
    escopo,
    sha256Hex(requisicaoCanonica),
  ].join("\n");

  const chave = hmac(
    hmac(
      hmac(hmac(`AWS4${credenciais.secretAccessKey}`, dia), credenciais.region),
      servico,
    ),
    "aws4_request",
  );
  const assinatura = createHmac("sha256", chave)
    .update(textoParaAssinar, "utf8")
    .digest("hex");

  return `AWS4-HMAC-SHA256 Credential=${credenciais.accessKeyId}/${escopo},SignedHeaders=${assinados},Signature=${assinatura}`;
}

/** `20260924T123456Z` */
function dataAmz(agora: Date): string {
  return agora
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * Chaves que nunca podem chegar ao armazenamento.
 *
 * No disco, a proteção é conferir que o caminho resolvido continua dentro da
 * raiz. Aqui não há raiz para escapar — mas `..` e barras duplas criariam
 * objetos que as rotinas de exclusão, que listam por prefixo, nunca
 * encontrariam. Recusar é mais simples que explicar depois.
 */
function conferirChave(chave: string): void {
  if (
    chave === "" ||
    chave.startsWith("/") ||
    chave.includes("\\") ||
    chave.includes("//") ||
    chave.split("/").some((parte) => parte === "." || parte === "..")
  ) {
    throw new Error(`Chave de armazenamento inválida: ${chave}`);
  }
}

function desfazerXml(texto: string): string {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function createS3Storage(
  cfg: ConfiguracaoS3,
  fetchImpl: typeof fetch = fetch,
  relogio: () => Date = () => new Date(),
): AudioStorage {
  const base = new URL(cfg.endpoint.replace(/\/+$/, ""));

  function urlDe(chave: string | null, consulta?: Record<string, string>): URL {
    const caminho = [
      base.pathname.replace(/\/+$/, ""),
      cfg.bucket,
      ...(chave === null ? [] : [chave]),
    ]
      .join("/")
      .replace(/^\/+/, "/");
    const url = new URL(base.origin);
    url.pathname = caminhoCodificado(caminho);
    for (const [k, v] of Object.entries(consulta ?? {})) url.searchParams.set(k, v);
    return url;
  }

  async function pedir(
    metodo: string,
    url: URL,
    corpo?: Uint8Array<ArrayBuffer>,
  ): Promise<Response> {
    const hashDoCorpo = corpo === undefined ? VAZIO_SHA256 : sha256Hex(corpo);
    const cabecalhos: Record<string, string> = {
      host: url.host,
      "x-amz-date": dataAmz(relogio()),
      "x-amz-content-sha256": hashDoCorpo,
    };
    const authorization = assinar({ metodo, url, cabecalhos, hashDoCorpo }, cfg);
    const { host: _host, ...enviados } = cabecalhos;
    return fetchImpl(url, {
      method: metodo,
      headers: {
        ...enviados,
        authorization,
        ...(corpo === undefined ? {} : { "content-type": "application/octet-stream" }),
      },
      ...(corpo === undefined ? {} : { body: corpo }),
      // Uma consulta longa são dezenas de megabytes; cinco minutos é folga.
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
  }

  async function falha(res: Response, oQue: string): Promise<Error> {
    // O corpo de erro do S3 é XML com código e mensagem — nunca a credencial.
    const corpo = await res.text().catch(() => "");
    const codigo = /<Code>([^<]*)<\/Code>/.exec(corpo)?.[1] ?? "";
    return new Error(
      `armazenamento respondeu ${res.status} ${codigo} ao ${oQue}`.trim(),
    );
  }

  return {
    kind: "s3",

    async put(chave, dados) {
      conferirChave(chave);
      const res = await pedir("PUT", urlDe(chave), dados);
      if (!res.ok) throw await falha(res, `gravar ${chave}`);
    },

    async get(chave) {
      conferirChave(chave);
      const res = await pedir("GET", urlDe(chave));
      if (!res.ok) throw await falha(res, `ler ${chave}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async remove(chave) {
      conferirChave(chave);
      const res = await pedir("DELETE", urlDe(chave));
      // Apagar o que já não existe é sucesso — igual ao `rm -f` do disco.
      if (!res.ok && res.status !== 404) throw await falha(res, `apagar ${chave}`);
    },

    async exists(chave) {
      conferirChave(chave);
      const res = await pedir("HEAD", urlDe(chave));
      if (res.status === 404) return false;
      if (!res.ok) throw await falha(res, `conferir ${chave}`);
      return true;
    },

    async list(prefixo) {
      // Prefixo como PASTA, igual ao disco: `partes/abc` lista o que está
      // dentro de `partes/abc/`, e não `partes/abcdef`.
      const pasta = prefixo === "" ? "" : `${prefixo.replace(/\/+$/, "")}/`;
      const chaves: string[] = [];
      let continuacao: string | undefined;
      do {
        const consulta: Record<string, string> = { "list-type": "2", prefix: pasta };
        if (continuacao !== undefined) consulta["continuation-token"] = continuacao;
        const res = await pedir("GET", urlDe(null, consulta));
        if (!res.ok) throw await falha(res, `listar ${prefixo}`);
        const xml = await res.text();
        for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
          if (m[1] !== undefined) chaves.push(desfazerXml(m[1]));
        }
        const truncado = /<IsTruncated>true<\/IsTruncated>/.test(xml);
        const proxima = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(
          xml,
        )?.[1];
        continuacao =
          truncado && proxima !== undefined ? desfazerXml(proxima) : undefined;
      } while (continuacao !== undefined);
      return chaves.sort();
    },
  };
}
