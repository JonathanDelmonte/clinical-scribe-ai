/**
 * O processamento de uma consulta — a fila e as etapas que falam com o banco.
 *
 * Dois consumidores: o worker da estação, que processa pelo motor do Docker, e
 * o site, que conduz estas mesmas etapas em nome do ajudante (o programa que
 * processa no computador de cada pessoa e não tem conexão com o banco). Um
 * pacote só, para os dois nunca decidirem diferente sobre a mesma consulta.
 * Ver ADR-0005.
 */

export {
  AJUDANTE_LIGADO_SEGUNDOS,
  claimJob,
  completeJob,
  ErroDefinitivo,
  ESTACAO_LIGADA_SEGUNDOS,
  failJob,
  LEASE_RENEW_MS,
  marcarEstacao,
  quemProcessa,
  reapAbandoned,
  renewLease,
  TIPOS_DO_AJUDANTE,
  type ClaimedJob,
  type Executor,
  type QuemPega,
} from "./fila";

export {
  faltaOPedaco,
  GRANDE_DEMAIS,
  juntarBytes,
  juntarPedacos,
  lerManifesto,
  lerPedacos,
  MANIFESTO_ILEGIVEL,
  MAX_BYTES_JUNTADOS,
  type Juntado,
} from "./pedacos";

export { formatoParaGuardar, type Guarda } from "./guarda";

export {
  gravarAndamento,
  gravarTranscricao,
  iniciarTranscricao,
  marcarFalha,
  parametrosDoMotor,
  pedacoFaltando,
  prepararTranscricao,
  recusarAudio,
  registrarGuarda,
  type Dono,
  type Fonte,
  type Preparo,
  type Registro,
  type Sessao,
} from "./transcricao";

export { esquemaDoResultado, lerResultado } from "./resultado";

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

export {
  chaveDaAmostraDeVoz,
  DIMENSOES_DA_IMPRESSAO_VOCAL,
  gravarImpressaoVocal,
  impressaoValida,
  lerPedidoDeVoz,
  TIPO_IMPRESSAO_VOCAL,
  VOZ_CURTA,
  VOZ_FALHOU,
  type PedidoDeVoz,
} from "./voz";
