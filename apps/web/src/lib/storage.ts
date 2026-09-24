import "server-only";

import { createStorageFromEnv } from "@scribe/storage";

/**
 * Armazenamento do áudio — o mesmo que o worker usa.
 *
 * Em produção, o Supabase Storage pelo protocolo S3 (as variáveis
 * `STORAGE_S3_*`); em desenvolvimento, uma pasta na raiz do monorepo. Quem
 * escolhe é `createStorageFromEnv`, num lugar só: a web grava o áudio, o
 * worker lê, e os dois precisam apontar para o mesmo lugar — caminhos
 * divergentes produziriam "arquivo não encontrado" num ponto que nenhum dos
 * dois lados testa sozinho.
 */
export const storage = createStorageFromEnv(process.env);
