import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import type { AudioStorage } from "./index";

/**
 * Armazenamento em disco, para desenvolvimento.
 *
 * Não é para produção: não replica, não criptografa em repouso e não
 * sobrevive ao container. Serve para fechar o tubo ponta a ponta sem exigir
 * conta em nuvem nenhuma antes de o produto existir.
 */
export function createLocalStorage(root: string): AudioStorage {
  const base = resolve(root);

  /**
   * Resolve a chave para um caminho DENTRO da raiz.
   *
   * A chave chega de fora (nome de arquivo enviado pelo navegador entra na
   * composição dela), então `../../etc/passwd` é uma entrada possível. Conferir
   * que o caminho resolvido continua sob a raiz é o que impede escrever fora
   * dela — validar a string antes de resolver não basta, porque symlinks e
   * normalização mudam o resultado.
   */
  function pathFor(key: string): string {
    const full = resolve(base, key);
    if (full !== base && !full.startsWith(base + sep)) {
      throw new Error(`Chave de armazenamento inválida: ${key}`);
    }
    return full;
  }

  return {
    kind: "local",

    async put(key, data) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },

    async get(key) {
      const buffer = await readFile(pathFor(key));
      return new Uint8Array(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer,
      );
    },

    async remove(key) {
      await rm(pathFor(key), { force: true });
    },

    async exists(key) {
      try {
        await stat(pathFor(key));
        return true;
      } catch {
        return false;
      }
    },

    async list(prefix) {
      const raiz = pathFor(prefix);
      let entradas;
      try {
        entradas = await readdir(raiz, { withFileTypes: true, recursive: true });
      } catch {
        // Pasta que não existe é lista vazia. Numa retomada de upload isso
        // significa "nenhum pedaço chegou ainda", que é o estado normal do
        // primeiro envio — não um erro para tratar.
        return [];
      }

      return entradas
        .filter((e) => e.isFile())
        .map((e) => {
          const relativa = resolve(e.parentPath, e.name).slice(base.length + 1);
          // Chaves usam `/` em qualquer sistema. No Windows o caminho vem com
          // `\\`, e uma chave com barra invertida não casa com a que foi
          // gravada — o pedaço existiria e não seria encontrado.
          return relativa.split(sep).join("/");
        })
        .sort();
    },
  };
}

/**
 * Resolve um caminho relativo contra a raiz do monorepo, não contra o diretório
 * de quem chamou.
 *
 * Sem isto, `.storage` significa `apps/web/.storage` para a aplicação e
 * `apps/worker/.storage` para o worker — duas pastas diferentes. A web grava o
 * áudio, o worker não acha, e o erro ("arquivo não encontrado") não aponta para
 * a causa. Caminho absoluto passa direto.
 */
export function resolveStorageRoot(root: string): string {
  if (isAbsolute(root)) return root;

  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return resolve(dir, root);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fora do monorepo (container em produção): relativo ao diretório atual.
  return resolve(process.cwd(), root);
}
