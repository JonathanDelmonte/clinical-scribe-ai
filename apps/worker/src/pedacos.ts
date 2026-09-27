import type { AudioStorage, ManifestoDePartes } from "@scribe/storage";

/** 2000 pedaços de 512 KB — o máximo que a rota de pedaços aceita. */
const MAX_BYTES_JUNTADOS = 1024 * 1024 * 1024;

export type Juntado =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly manifesto: ManifestoDePartes;
    }
  | { readonly ok: false; readonly motivo: string };

function lerManifesto(dados: Uint8Array): ManifestoDePartes | null {
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

/**
 * Junta, em ordem, os pedaços que o manifesto descreve.
 *
 * Pedaço que NÃO EXISTE torna a consulta incompleta, e isso é devolvido como
 * motivo — juntar com um buraco seria transcrever uma consulta sem um trecho,
 * sem erro em lugar nenhum. Já uma falha AO LER (rede, armazenamento fora do
 * ar) é lançada: o pedaço provavelmente está lá, e a fila tenta de novo.
 */
export async function juntarPedacos(
  storage: AudioStorage,
  chaveDoManifesto: string,
  chaveDoPedaco: (indice: number) => string,
): Promise<Juntado> {
  const manifesto = lerManifesto(await storage.get(chaveDoManifesto));
  if (manifesto === null) {
    return { ok: false, motivo: "o registro dos pedaços da gravação está ilegível" };
  }

  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < manifesto.partes; i++) {
    const chave = chaveDoPedaco(i);
    let pedaco: Uint8Array;
    try {
      pedaco = await storage.get(chave);
    } catch (erro) {
      if (!(await storage.exists(chave))) {
        return {
          ok: false,
          motivo: `falta o pedaço ${i + 1} de ${manifesto.partes} da gravação`,
        };
      }
      throw erro;
    }
    total += pedaco.byteLength;
    if (total > MAX_BYTES_JUNTADOS) {
      return { ok: false, motivo: "gravação grande demais para processar" };
    }
    pedacos.push(pedaco);
  }

  const bytes = new Uint8Array(total);
  let posicao = 0;
  for (const pedaco of pedacos) {
    bytes.set(pedaco, posicao);
    posicao += pedaco.byteLength;
  }
  return { ok: true, bytes, manifesto };
}
