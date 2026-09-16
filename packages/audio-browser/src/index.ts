export type { SpeechRegion } from "./regions";
export {
  mergeRegions,
  padRegions,
  toOriginalMs,
  totalMs,
  toTrimmedMs,
} from "./regions";

export type { VadOptions } from "./vad";
export { detectSpeech } from "./vad";

export type { PreparedAudio, PrepareOptions } from "./prepare";
export { prepareForUpload, TAXA_ALVO } from "./prepare";
