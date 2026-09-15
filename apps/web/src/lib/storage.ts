import "server-only";

import { createLocalStorage, resolveStorageRoot } from "@scribe/storage";

/**
 * Armazenamento do áudio.
 *
 * A raiz é resolvida contra a raiz do monorepo, não contra o diretório do
 * Next. É o que garante que a web e o worker apontem para a MESMA pasta —
 * caminhos divergentes produziriam "arquivo não encontrado" num ponto que
 * nenhum dos dois lados testa sozinho.
 */
export const storage = createLocalStorage(
  resolveStorageRoot(process.env["STORAGE_ROOT"] ?? ".storage"),
);
