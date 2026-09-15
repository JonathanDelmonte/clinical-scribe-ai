/**
 * Armazenamento do áudio das consultas.
 *
 * A web escreve, o worker lê, e os dois precisam concordar na convenção de
 * chave. Por isso isto é um pacote e não código duplicado nos dois lados: uma
 * divergência de convenção viraria "arquivo não encontrado" em produção, num
 * caminho que ninguém testa porque cada lado funciona sozinho.
 *
 * Hoje grava em disco. A implementação do Supabase Storage entra atrás da
 * mesma interface, sem mexer em quem usa.
 */

export interface AudioStorage {
  readonly kind: string;
  put(key: string, data: Uint8Array<ArrayBuffer>): Promise<void>;
  get(key: string): Promise<Uint8Array<ArrayBuffer>>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Chave do áudio de uma sessão.
 *
 * O ID do profissional vem PRIMEIRO no caminho, e isso não é organização: é a
 * mesma regra de isolamento que vale no banco. Quando o Supabase Storage
 * entrar, a política de acesso dele é um prefixo de caminho — e um layout que
 * começa pelo dono já nasce compatível. Layout `sessions/<id>.wav` obrigaria
 * uma consulta ao banco a cada verificação de permissão.
 */
export function sessionAudioKey(
  professionalId: string,
  sessionId: string,
  extension: string,
): string {
  const ext = extension.replace(/^\./, "").toLowerCase();
  return `${professionalId}/${sessionId}.${ext}`;
}

/** Extensão do nome do arquivo, ou `webm` — o formato que o MediaRecorder dá. */
export function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(filename);
  return match?.[1]?.toLowerCase() ?? "webm";
}

export { createLocalStorage, resolveStorageRoot } from "./local";
