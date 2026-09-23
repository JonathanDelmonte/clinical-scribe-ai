/**
 * O que conta como áudio aceitável, e quanto corpo de requisição cabe numa
 * viagem só.
 *
 * Este módulo não importa `server-only` de propósito: a tela precisa das
 * mesmas respostas que as rotas. Recusar um formato no navegador — antes de
 * criar sessão e antes de subir um megabyte — é a diferença entre "este
 * arquivo não serve" dito na hora e um erro dito depois do envio, com uma
 * sessão vazia já criada no prontuário do paciente.
 *
 * `upload.ts` é `server-only` e continua sendo o dono das regras de quota e
 * de enfileiramento. O que desceu para cá é só o que os dois lados precisam
 * saber igual.
 */

/**
 * O teto do corpo de requisição que o Next guarda em memória.
 *
 * Com um `proxy.ts` no projeto, o Next **clona o corpo de toda requisição** e
 * o bufferiza, para que o proxy e a rota possam lê-lo — duas leituras de um
 * stream que só pode ser lido uma vez. Para não estourar a memória, ele para
 * de guardar num certo ponto.
 *
 * O que acontece depois desse ponto é o detalhe que custou um bug:
 *
 * > *"The request will **not** fail or return an error to the client."*
 * > — documentação do `proxyClientMaxBodySize`
 *
 * **A requisição continua, com o corpo cortado.** Não há 413, não há exceção.
 * Num corpo `multipart`, o corte leva embora a fronteira final e
 * `formData()` lança — foi o que produziu o enigmático "envie um arquivo no
 * campo 'file'" para qualquer áudio acima deste tamanho. Num corpo cru é pior:
 * a rota recebe menos bytes, em silêncio, e grava um áudio de consulta com o
 * fim faltando.
 *
 * Por isso o número mora aqui, nomeado, e não no padrão invisível do
 * framework: `next.config.ts` o usa para configurar o Next, e as rotas que
 * recebem corpo o usam para recusar **antes** de receber um corpo cortado.
 * Um número só, dois lados — a única forma de os dois não divergirem.
 *
 * ⚠️ Nenhuma rota pode aceitar um corpo maior que isto. O caminho do áudio
 * grande é o envio em pedaços, em que cada pedaço cabe aqui com folga.
 */
export const MAX_CORPO_BUFFERIZADO_BYTES = 10 * 1024 * 1024;

/** ~200 MB. Uma consulta de uma hora em webm/opus fica bem abaixo disso. */
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/**
 * Extensões aceitas.
 *
 * Lista fechada em vez de confiar no content-type: o tipo declarado vem do
 * cliente e não custa nada mentir. A extensão só decide o nome do arquivo em
 * disco — quem realmente decodifica é o ffmpeg dentro do serviço de ASR, que
 * olha o conteúdo.
 */
export const EXTENSOES_ACEITAS: ReadonlySet<string> = new Set([
  "webm",
  "wav",
  "mp3",
  "m4a",
  "ogg",
  "opus",
  "flac",
  "mp4",
]);

/** O que o seletor de arquivos oferece — a mesma lista, do jeito que o `accept` pede. */
export const ACCEPT_DE_AUDIO = [
  "audio/*",
  ...[...EXTENSOES_ACEITAS].map((e) => `.${e}`),
].join(",");

/**
 * A extensão de um nome de arquivo, minúscula e sem o ponto.
 *
 * Devolve `""` quando não há extensão, e isso é deliberado: o
 * `extensionOf()` do armazenamento chuta `"webm"` nesse caso, que é a
 * suposição certa para nomear um arquivo em disco e a errada para decidir se
 * aceitamos o que a pessoa escolheu. Aqui, não saber significa recusar.
 */
export function extensaoDoNome(nome: string): string {
  return /\.([a-z0-9]{1,8})$/i.exec(nome)?.[1]?.toLowerCase() ?? "";
}
