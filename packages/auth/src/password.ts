/**
 * Senhas — derivação com scrypt, do `node:crypto`.
 *
 * ## Por que scrypt e não bcrypt ou argon2
 *
 * Os dois são ótimos e os dois são dependência nativa: compilam binário na
 * instalação, quebram quando a versão do Node muda, e obrigam o CI e o
 * contêiner a carregar toolchain de compilação. O scrypt vem no Node, é
 * memory-hard (que é o que derruba ataque em GPU) e está na mesma família de
 * recomendação do OWASP.
 *
 * Não é a derivação mais moderna que existe. É a mais moderna que não custa
 * uma dependência nativa a mais num projeto que já tem Whisper, pyannote e
 * CUDA para operar.
 *
 * ## Por que os parâmetros ficam DENTRO do hash
 *
 * `scrypt$16384$8$1$sal$derivado`. No dia em que o custo subir — e ele sobe, é
 * assim que se acompanha o hardware —, os hashes antigos continuam conferindo
 * com os parâmetros antigos, porque cada um carrega os seus. A alternativa,
 * parâmetros fixos no código, transforma um ajuste de custo em "todo mundo
 * perdeu a senha".
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

/**
 * A anotação explícita existe porque `promisify` escolhe UMA das sobrecargas
 * de `scrypt`, e escolhe a que não recebe opções. Sem ela, passar os
 * parâmetros de custo vira erro de tipo — e a saída fácil seria remover os
 * parâmetros, que é justamente o que não pode acontecer aqui.
 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Custo. `N=16384, r=8, p=1` gasta ~16 MB e uns 50 ms por tentativa numa
 * máquina comum — desprezível para quem digita a senha uma vez, caro o
 * bastante para quem tenta um dicionário inteiro.
 */
const N = 16_384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

/**
 * `maxmem` explícito porque o padrão do Node (32 MB) fica perto demais do
 * consumo de `N=16384`: subir o custo um degrau passaria a lançar
 * "memory limit exceeded" em vez de simplesmente demorar mais — um erro que
 * aparece como falha de login e não como falha de configuração.
 */
const MAXMEM = 128 * 1024 * 1024;

/** Mínimo de caracteres. Comprimento vale mais que tabela de símbolos. */
export const SENHA_MINIMA = 10;
export const SENHA_MAXIMA = 200;

export function senhaInvalida(senha: string): string | null {
  if (senha.length < SENHA_MINIMA) {
    return `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`;
  }
  if (senha.length > SENHA_MAXIMA) {
    return `A senha passa de ${SENHA_MAXIMA} caracteres.`;
  }
  return null;
}

export async function hashPassword(senha: string): Promise<string> {
  const sal = randomBytes(SALT_BYTES);
  const derivado = await scrypt(senha.normalize("NFKC"), sal, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });

  return [
    "scrypt",
    N,
    R,
    P,
    sal.toString("base64url"),
    derivado.toString("base64url"),
  ].join("$");
}

/**
 * Confere a senha contra o hash guardado.
 *
 * Devolve `false` para hash malformado em vez de lançar: um registro
 * corrompido no banco é problema de operação, e transformá-lo em erro 500 no
 * login conta ao visitante que aquela conta existe e está quebrada.
 */
export async function verifyPassword(
  senha: string,
  guardado: string,
): Promise<boolean> {
  const partes = guardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;

  const n = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  let sal: Buffer;
  let esperado: Buffer;
  try {
    sal = Buffer.from(partes[4] ?? "", "base64url");
    esperado = Buffer.from(partes[5] ?? "", "base64url");
  } catch {
    return false;
  }
  if (sal.length === 0 || esperado.length === 0) return false;

  let derivado: Buffer;
  try {
    derivado = await scrypt(senha.normalize("NFKC"), sal, esperado.length, {
      N: n,
      r,
      p,
      maxmem: MAXMEM,
    });
  } catch {
    // Parâmetros absurdos vindos de um registro adulterado não derrubam o
    // processo: é uma senha que não confere.
    return false;
  }

  return derivado.length === esperado.length && timingSafeEqual(derivado, esperado);
}

/**
 * Um hash descartável, usado quando o e-mail não existe.
 *
 * Sem isto, um login com e-mail inexistente responde em 1 ms e um com e-mail
 * certo e senha errada responde em 50 ms — e essa diferença é um oráculo que
 * responde "esta pessoa tem conta aqui" a quem quiser perguntar. Num produto
 * de saúde, a lista de quem tem conta já é informação sensível.
 *
 * Gerado uma vez por processo, com uma senha aleatória que ninguém conhece.
 */
let iscaPromise: Promise<string> | null = null;
export function hashDeIsca(): Promise<string> {
  iscaPromise ??= hashPassword(randomBytes(32).toString("base64url"));
  return iscaPromise;
}
