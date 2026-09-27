/**
 * O buffer da gravação no próprio dispositivo.
 *
 * ## Por que existe
 *
 * O `MediaRecorder` entrega pedaços de áudio, e a versão anterior os guardava
 * num array em memória. Isso funciona até a aba morrer — e no celular ela
 * morre: o sistema recupera memória de abas em segundo plano, uma ligação
 * chega, a tela bloqueia, o navegador é encerrado. Quando isso acontece no
 * meio de uma consulta, o que se perde não é um formulário: é uma conversa que
 * aconteceu uma vez e não vai se repetir.
 *
 * Gravar cada pedaço no IndexedDB assim que ele chega custa alguns
 * milissegundos e transforma "perdeu tudo" em "está no aparelho, é só enviar".
 *
 * **Gravar localmente vem antes de transportar.** O que nunca foi escrito não
 * tem como ser recuperado, e é por isso que o buffer é anterior ao envio em
 * pedaços, e não o contrário.
 *
 * ## O que isto NÃO é
 *
 * Não é armazenamento de longo prazo. O áudio de uma consulta é dado sensível
 * de saúde: ele fica aqui pelo tempo entre a gravação e o envio, e some assim
 * que o servidor confirma. `limparAntigas()` varre o que ficou para trás —
 * aparelho compartilhado de consultório não pode acumular consultas de meses.
 */

const BANCO = "consulta-viva-gravacoes";
const VERSAO = 1;
const GRAVACOES = "gravacoes";
const PEDACOS = "pedacos";

/** Depois disto, uma gravação não enviada é lixo, e lixo com dado de saúde. */
export const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;

export interface GravacaoPendente {
  readonly sessionId: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly criadaEm: number;
  readonly mimeType: string;
  readonly extensao: string;
  /** Quantos pedaços foram gravados até agora. */
  readonly pedacos: number;
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(BANCO, VERSAO);

    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains(GRAVACOES)) {
        db.createObjectStore(GRAVACOES, { keyPath: "sessionId" });
      }
      if (!db.objectStoreNames.contains(PEDACOS)) {
        // Chave composta [sessionId, indice]: é o que faz `getAll` sobre uma
        // faixa devolver os pedaços de UMA gravação, já em ordem.
        db.createObjectStore(PEDACOS, { keyPath: ["sessionId", "indice"] });
      }
    };

    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error ?? new Error("IndexedDB indisponível"));
  });
}

function aguardar<T>(pedido: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error ?? new Error("falha no IndexedDB"));
  });
}

export async function iniciarGravacao(
  dados: Omit<GravacaoPendente, "pedacos" | "criadaEm">,
): Promise<void> {
  const db = await abrir();
  try {
    const tx = db.transaction(GRAVACOES, "readwrite");
    await aguardar(
      tx.objectStore(GRAVACOES).put({ ...dados, criadaEm: Date.now(), pedacos: 0 }),
    );
  } finally {
    db.close();
  }
}

export async function gravarPedaco(
  sessionId: string,
  indice: number,
  dados: Blob,
): Promise<void> {
  const db = await abrir();
  try {
    // Os dois stores na MESMA transação: o contador e o pedaço precisam andar
    // juntos, senão uma queda entre as duas escritas deixa o buffer dizendo
    // que tem mais pedaços do que realmente guardou.
    const tx = db.transaction([PEDACOS, GRAVACOES], "readwrite");
    await aguardar(tx.objectStore(PEDACOS).put({ sessionId, indice, dados }));

    const registro = (await aguardar(tx.objectStore(GRAVACOES).get(sessionId))) as
      GravacaoPendente | undefined;

    if (registro !== undefined) {
      await aguardar(
        tx.objectStore(GRAVACOES).put({
          ...registro,
          pedacos: Math.max(registro.pedacos, indice + 1),
        }),
      );
    }
  } finally {
    db.close();
  }
}

interface Pedaco {
  readonly indice: number;
  readonly dados: Blob;
}

async function lerPedacos(sessionId: string): Promise<Pedaco[]> {
  const db = await abrir();
  try {
    const faixa = IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);
    return (await aguardar(
      db.transaction(PEDACOS, "readonly").objectStore(PEDACOS).getAll(faixa),
    )) as Pedaco[];
  } finally {
    db.close();
  }
}

/**
 * Os pedaços do aparelho e os da memória, cada um no seu lugar.
 *
 * Ordenação explícita: o IndexedDB devolve em ordem de chave, e a chave é
 * numérica, então já viria certo. Mas o custo de garantir é zero, e o custo de
 * estar errado é a consulta com o meio fora de lugar.
 */
export function emOrdem(
  doAparelho: readonly Pedaco[],
  daMemoria: ReadonlyMap<number, Blob>,
): Blob[] {
  const porIndice = new Map(doAparelho.map((p) => [p.indice, p.dados] as const));
  for (const [indice, dados] of daMemoria) {
    if (!porIndice.has(indice)) porIndice.set(indice, dados);
  }
  return [...porIndice.entries()].sort(([a], [b]) => a - b).map(([, dados]) => dados);
}

/**
 * Os pedaços de uma gravação, em ordem, remontados num blob só.
 *
 * `reserva` são os pedaços que o aparelho recusou guardar — pouco espaço
 * livre, banco bloqueado — e que ficaram na memória da aba (ver
 * `SessionRecorder`). Se nem o banco abre, a reserva sozinha basta quando ela
 * tem a gravação INTEIRA, os `total` pedaços; faltando algum, o erro sobe, e
 * a pessoa tenta de novo em vez de enviar uma consulta pela metade.
 */
export async function montarGravacao(
  sessionId: string,
  mimeType: string,
  reserva: ReadonlyMap<number, Blob> = new Map(),
  total = 0,
): Promise<Blob | null> {
  let doAparelho: Pedaco[];
  try {
    doAparelho = await lerPedacos(sessionId);
  } catch (erro) {
    if (total === 0 || reserva.size < total) throw erro;
    doAparelho = [];
  }

  const pedacos = emOrdem(doAparelho, reserva);
  return pedacos.length === 0 ? null : new Blob(pedacos, { type: mimeType });
}

export async function listarPendentes(): Promise<GravacaoPendente[]> {
  const db = await abrir();
  try {
    const linhas = (await aguardar(
      db.transaction(GRAVACOES, "readonly").objectStore(GRAVACOES).getAll(),
    )) as GravacaoPendente[];
    return linhas.filter((g) => g.pedacos > 0).sort((a, b) => b.criadaEm - a.criadaEm);
  } finally {
    db.close();
  }
}

export async function descartarGravacao(sessionId: string): Promise<void> {
  const db = await abrir();
  try {
    const tx = db.transaction([PEDACOS, GRAVACOES], "readwrite");
    const faixa = IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);
    await aguardar(tx.objectStore(PEDACOS).delete(faixa));
    await aguardar(tx.objectStore(GRAVACOES).delete(sessionId));
  } finally {
    db.close();
  }
}

/**
 * Apaga o que ficou para trás.
 *
 * Chamado na abertura da tela de gravação. Não é limpeza de disco: é
 * minimização de dado sensível — o aparelho do consultório costuma ser
 * compartilhado, e áudio de consulta não pode ficar acumulando nele.
 */
export async function limparAntigas(agora: number = Date.now()): Promise<number> {
  const pendentes = await listarPendentes().catch(() => []);
  const velhas = pendentes.filter((g) => agora - g.criadaEm > VALIDADE_MS);
  for (const g of velhas) await descartarGravacao(g.sessionId).catch(() => undefined);
  return velhas.length;
}

/** O IndexedDB pode estar bloqueado — janela anônima, política do navegador. */
export function bufferDisponivel(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}
