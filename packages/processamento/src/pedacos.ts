import type { AudioStorage, ManifestoDePartes } from "@scribe/storage";

/** 2000 pedaços de 512 KB — o máximo que a rota de pedaços aceita. */
export const MAX_BYTES_JUNTADOS = 1024 * 1024 * 1024;

export type Juntado =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly manifesto: ManifestoDePartes;
    }
  | { readonly ok: false; readonly motivo: string };

export const MANIFESTO_ILEGIVEL = "o registro dos pedaços da gravação está ilegível";

export function lerManifesto(dados: Uint8Array): ManifestoDePartes | null {
  try {
    const bruto = JSON.parse(new TextDecoder().decode(dados)) as Record<
      string,
      unknown
    >;
    const partes = bruto["partes"];
    const extensao = bruto["extensao"];
    if (
      typeof partes !== "number" ||
      !Number.isInteger(partes) ||
      partes < 1 ||
      partes > 2000 ||
      typeof extensao !== "string" ||
      !/^[a-z0-9]{1,8}$/.test(extensao)
    ) {
      return null;
    }
    return { partes, extensao };
  } catch {
    return null;
  }
}

/** A mensagem de um pedaço que não chegou — a mesma na estação e no ajudante. */
export function faltaOPedaco(indice: number, total: number): string {
  return `falta o pedaço ${indice + 1} de ${total} da gravação`;
}

export const GRANDE_DEMAIS = "gravação grande demais para processar";

/** Junta pedaços já lidos, em ordem, conferindo o limite de tamanho. */
export function juntarBytes(
  pedacos: readonly Uint8Array[],
):
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly motivo: string } {
  const total = pedacos.reduce((soma, p) => soma + p.byteLength, 0);
  if (total > MAX_BYTES_JUNTADOS) return { ok: false, motivo: GRANDE_DEMAIS };
  const bytes = new Uint8Array(total);
  let posicao = 0;
  for (const pedaco of pedacos) {
    bytes.set(pedaco, posicao);
    posicao += pedaco.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * Junta, em ordem, os pedaços que o manifesto descreve.
 *
 * Pedaço que NÃO EXISTE torna a consulta incompleta, e isso é devolvido como
 * motivo — juntar com um buraco seria transcrever uma consulta sem um trecho,
 * sem erro em lugar nenhum. Já uma falha AO LER (rede, armazenamento fora do
 * ar) é lançada: o pedaço provavelmente está lá, e a fila tenta de novo.
 */
export async function juntarPedacos(
  storage: Pick<AudioStorage, "get" | "exists">,
  chaveDoManifesto: string,
  chaveDoPedaco: (indice: number) => string,
): Promise<Juntado> {
  const manifesto = lerManifesto(await storage.get(chaveDoManifesto));
  if (manifesto === null) {
    return { ok: false, motivo: MANIFESTO_ILEGIVEL };
  }
  const lidos = await lerPedacos(
    storage,
    Array.from({ length: manifesto.partes }, (_, i) => chaveDoPedaco(i)),
  );
  if (!lidos.ok) return lidos;
  return { ok: true, bytes: lidos.bytes, manifesto };
}

/** Lê e junta pedaços já conhecidos pela chave, em ordem — ver `juntarPedacos`. */
export async function lerPedacos(
  storage: Pick<AudioStorage, "get" | "exists">,
  chaves: readonly string[],
): Promise<
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly motivo: string }
> {
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (const [i, chave] of chaves.entries()) {
    let pedaco: Uint8Array;
    try {
      pedaco = await storage.get(chave);
    } catch (erro) {
      if (!(await storage.exists(chave))) {
        return { ok: false, motivo: faltaOPedaco(i, chaves.length) };
      }
      throw erro;
    }
    total += pedaco.byteLength;
    if (total > MAX_BYTES_JUNTADOS) {
      return { ok: false, motivo: GRANDE_DEMAIS };
    }
    pedacos.push(pedaco);
  }
  return juntarBytes(pedacos);
}
