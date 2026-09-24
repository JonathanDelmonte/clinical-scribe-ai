export type { SpeechRegion } from "./regions";
export {
  mergeRegions,
  padRegions,
  toOriginalMs,
  totalMs,
  toTrimmedMs,
} from "./regions";

export type { VadOptions } from "./vad";
export { detectSpeech, limiarDb } from "./vad";

export type { ChunkerOptions } from "./chunker";
export { SpeechChunker } from "./chunker";

export type { PreparedAudio, PrepareOptions } from "./prepare";
export { prepareForUpload, TAXA_ALVO } from "./prepare";

export type { LeituraDoEnvelope, MedidaDoSegundoMicrofone } from "./envelope";
export {
  CABECALHO_ENVELOPE,
  codificarEnvelope,
  energiaPorPasso,
  lerCabecalhoDoEnvelope,
  MAX_BYTES_ENVELOPE,
  MAX_PASSOS_ENVELOPE,
  medirSegundoMicrofone,
  PASSO_ENVELOPE,
  TAXA_ENVELOPE,
} from "./envelope";
