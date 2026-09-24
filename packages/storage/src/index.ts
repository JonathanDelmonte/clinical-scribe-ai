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
  /**
   * As chaves sob um prefixo, em ordem.
   *
   * Existe para a retomada de upload: quando a rede cai no meio do envio, o
   * navegador precisa saber quais pedaços já chegaram, e perguntar
   * `exists()` para cada índice possível é N requisições para responder o que
   * uma responde.
   *
   * Prefixo vazio devolve tudo; prefixo inexistente devolve lista vazia, e
   * não erro — "não há nada aqui" é uma resposta, não uma falha.
   */
  list(prefix: string): Promise<string[]>;
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

/**
 * Chave dos pedaços de um upload em andamento.
 *
 * Uma pasta por sessão, separada do áudio final: assim a lista de pedaços é um
 * `list()` de um prefixo, e a limpeza depois da montagem apaga uma pasta
 * inteira sem risco de levar junto o arquivo que acabou de ser montado.
 */
export function sessionPartKey(
  professionalId: string,
  sessionId: string,
  index: number,
): string {
  // Índice com largura fixa: é o que faz a ordenação alfabética das chaves
  // coincidir com a ordem dos pedaços. Sem o zero à esquerda, "10" vem antes
  // de "2" — e o áudio remontado fica com o meio da consulta fora de ordem.
  return `${professionalId}/partes/${sessionId}/${String(index).padStart(5, "0")}`;
}

/** O prefixo de todos os pedaços de uma sessão. */
export function sessionPartsPrefix(professionalId: string, sessionId: string): string {
  return `${professionalId}/partes/${sessionId}`;
}

/**
 * Chave de um arquivo do próprio profissional — hoje, a assinatura.
 *
 * Mesma regra do áudio: o dono vem primeiro no caminho, para que a política de
 * acesso do armazenamento seja um prefixo e não uma consulta ao banco.
 */
export function professionalFileKey(professionalId: string, name: string): string {
  if (!/^[a-z0-9._-]+$/.test(name)) {
    throw new Error(`Nome de arquivo inválido: ${name}`);
  }
  return `${professionalId}/perfil/${name}`;
}

/**
 * Chave do segundo microfone de uma sessão.
 *
 * Extensão fixa porque o conteúdo não varia: não é o arquivo que o celular
 * gravou — esse nunca sai do aparelho —, e sim a energia dele a cada 5 ms,
 * medida no navegador, no formato que o motor lê (ver `canais.py`). Ao lado do
 * áudio principal e sob o mesmo dono, pela mesma regra de `sessionAudioKey`.
 */
export function secondChannelKey(professionalId: string, sessionId: string): string {
  return `${professionalId}/${sessionId}-segundo-microfone.cve`;
}

/**
 * TODOS os arquivos da gravação de uma sessão — o que apagar quando ela sai.
 *
 * Existe para que apagar seja uma pergunta com uma resposta só. Três rotinas
 * apagam gravação — exclusão de conta, exclusão de sessão, retenção — e cada
 * uma listar os arquivos por conta própria funcionaria até o dia em que
 * surgisse mais um. Aí uma das três esqueceria, e algo derivado da consulta de
 * um paciente ficaria guardado além do prazo que o profissional escolheu, sem
 * erro nenhum.
 *
 * O segundo microfone entra mesmo não sendo áudio: é medida da consulta, sem
 * serventia depois que o áudio principal se vai, e guardá-lo além dele seria
 * reter por reter.
 */
export function arquivosDaGravacao(sessao: {
  audioPath: string | null;
  secondChannelPath?: string | null;
}): string[] {
  return [sessao.audioPath, sessao.secondChannelPath ?? null].filter(
    (k): k is string => k !== null && k !== "",
  );
}

/** Extensão do nome do arquivo, ou `webm` — o formato que o MediaRecorder dá. */
export function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(filename);
  return match?.[1]?.toLowerCase() ?? "webm";
}

export { createLocalStorage, resolveStorageRoot } from "./local";
