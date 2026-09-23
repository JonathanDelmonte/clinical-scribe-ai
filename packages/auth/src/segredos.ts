/**
 * Cofre para segredos de terceiros — a chave de IA que o profissional traz.
 *
 * ## Por que isto não é como guardar senha
 *
 * Senha a gente NUNCA precisa de volta: guarda-se um hash, compara-se, pronto.
 * Se o banco vazar, ninguém tem as senhas — tem hashes caros de reverter.
 *
 * Uma chave de API é o oposto: ela precisa ser usada, em texto puro, toda vez
 * que o worker chama o fornecedor. Não dá para guardar um hash. Só dá para
 * guardar cifrada, e isso muda a natureza do problema — o segredo continua
 * existindo, só está trancado.
 *
 * ## O que isto protege, e o que não protege
 *
 * **Protege contra vazamento do banco.** A chave de cifra não está lá: vive
 * numa variável de ambiente. Um dump do Postgres — o vazamento mais comum que
 * existe, por backup exposto, réplica mal configurada, `pg_dump` esquecido num
 * bucket — entrega texto cifrado e nada mais.
 *
 * **Não protege contra quem invade o servidor de aplicação**, que tem a chave
 * de cifra na memória por definição. Para esse caso a resposta é um KMS, e
 * este módulo foi feito para caber num: `cifrar`/`decifrar` são a única porta,
 * e trocá-las por chamadas a um serviço externo mexe em dois lugares.
 *
 * ## Por que o segredo do cliente e o nosso não se misturam
 *
 * Uma chave vazada aqui não é um incidente do nosso produto. É a conta do
 * profissional sendo usada por outra pessoa, com cobrança real na fatura
 * dele — e a culpa é nossa, porque fomos nós que perdemos. Ver ADR-0003.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * AES-256-GCM, e não AES-CBC.
 *
 * GCM é autenticado: além de esconder, ele detecta alteração. Sem isso, quem
 * conseguisse escrever no banco poderia trocar bytes do texto cifrado e a
 * decifragem devolveria lixo — que o código trataria como uma chave válida e
 * mandaria para o fornecedor. Com GCM, alterar um bit faz a decifragem falhar.
 */
const ALGORITMO = "aes-256-gcm";
const TAMANHO_IV = 12;
const TAMANHO_CHAVE = 32;

/**
 * Prefixo de versão no próprio texto cifrado.
 *
 * Parece detalhe e é o que torna a rotação possível: quando a chave mestra
 * mudar, ou o algoritmo, os segredos antigos continuam legíveis porque o
 * formato diz qual esquema os produziu. Sem isso, trocar a chave exigiria
 * migrar todo mundo de uma vez — que é o motivo pelo qual chaves nunca são
 * rotacionadas na prática.
 */
const VERSAO = "v1";

export class SegredoIndisponivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "SegredoIndisponivel";
  }
}

/**
 * A chave mestra, lida do ambiente.
 *
 * Lida a cada chamada, e não guardada num módulo: em desenvolvimento a
 * variável muda sem reiniciar o processo, e um valor preso na memória faria o
 * cofre continuar usando a chave antiga sem dizer nada.
 */
function chaveMestra(): Buffer {
  const bruta = process.env["SEGREDO_MESTRE"] ?? "";
  if (bruta === "") {
    throw new SegredoIndisponivel(
      "SEGREDO_MESTRE não definida. Ela cifra as chaves de IA dos " +
        "profissionais.\nGere uma com:  node -e \"console.log(require('crypto')" +
        ".randomBytes(32).toString('base64'))\"",
    );
  }

  const chave = Buffer.from(bruta, "base64");
  if (chave.length !== TAMANHO_CHAVE) {
    throw new SegredoIndisponivel(
      `SEGREDO_MESTRE precisa ter ${TAMANHO_CHAVE} bytes em base64 ` +
        `(tem ${chave.length}). Gere uma nova em vez de completar a atual.`,
    );
  }
  return chave;
}

/** Há chave mestra configurada? Para a interface avisar antes de pedir a chave. */
export function cofreDisponivel(): boolean {
  try {
    chaveMestra();
    return true;
  } catch {
    return false;
  }
}

export function cifrar(texto: string): string {
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv(ALGORITMO, chaveMestra(), iv);
  const dados = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  const tag = cifra.getAuthTag();

  return [
    VERSAO,
    iv.toString("base64"),
    tag.toString("base64"),
    dados.toString("base64"),
  ].join(".");
}

/**
 * Devolve o texto puro, ou lança.
 *
 * Lança em vez de devolver `null` de propósito: um segredo que não abre é um
 * problema de configuração ou de integridade, nunca um caso normal. Devolver
 * nulo convidaria quem chama a seguir em frente com um valor vazio — e o
 * sintoma seria uma chamada ao fornecedor sem autenticação, cujo erro não diz
 * nada sobre a causa.
 */
export function decifrar(cofre: string): string {
  const partes = cofre.split(".");
  if (partes.length !== 4 || partes[0] !== VERSAO) {
    throw new SegredoIndisponivel("formato de segredo não reconhecido");
  }
  const [, ivB64, tagB64, dadosB64] = partes as [string, string, string, string];

  try {
    const decifra = createDecipheriv(
      ALGORITMO,
      chaveMestra(),
      Buffer.from(ivB64, "base64"),
    );
    decifra.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decifra.update(Buffer.from(dadosB64, "base64")),
      decifra.final(),
    ]).toString("utf8");
  } catch {
    // A mensagem não distingue "chave mestra errada" de "texto adulterado".
    // Ambas significam a mesma coisa para quem opera — este segredo não abre —
    // e detalhar ajudaria mais quem está atacando do que quem está corrigindo.
    throw new SegredoIndisponivel(
      "não foi possível abrir o segredo: chave mestra trocada ou dado alterado",
    );
  }
}

/**
 * O que a tela pode mostrar: os últimos quatro caracteres.
 *
 * O suficiente para a pessoa reconhecer QUAL chave está ali, e insuficiente
 * para qualquer outra coisa. A chave inteira nunca volta ao navegador — uma
 * rota que a devolvesse "para preencher o formulário" seria uma rota que a
 * entrega a qualquer XSS.
 */
export function dicaDaChave(chave: string): string {
  const limpa = chave.trim();
  return limpa.length <= 4 ? "••••" : `••••${limpa.slice(-4)}`;
}

/** Dois segredos são o mesmo? Em tempo constante, para não vazar por medida. */
export function mesmoSegredo(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
