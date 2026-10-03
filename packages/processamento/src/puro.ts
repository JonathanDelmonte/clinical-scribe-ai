/**
 * A parte do pacote que não fala com o banco — o que o ajudante (o programa
 * do Windows) leva dentro dele: o contrato com o site e as regras puras.
 *
 * Uma entrada à parte porque o empacotador do ajudante leva tudo o que o
 * arquivo importa: pela entrada principal, levaria junto o cliente do banco,
 * que ele nem pode usar.
 */

export {
  esquemaDaEntrega,
  esquemaDaFalha,
  esquemaDoAndamento,
  esquemaDoAvisoDeAudio,
  esquemaDoSinal,
  type Andamento,
  type AvisoDeAudio,
  type Entrega,
  type Falha,
  type OrdemDeServico,
  type RespostaDoAudio,
  type Sinal,
} from "./contrato";
export { formatoParaGuardar } from "./guarda";
export { GRANDE_DEMAIS, juntarBytes, MAX_BYTES_JUNTADOS } from "./pedacos";
