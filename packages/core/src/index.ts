export type {
  CitedStatement,
  DocumentType,
  SessionStatus,
  SpeakerRole,
  SpeakerRoleSource,
  TranscriptSegment,
} from "./domain.js";
export { SPEAKER_ROLES } from "./domain.js";

export type { CitationIssue } from "./citations.js";
export {
  formatSegmentsForPrompt,
  formatTimestamp,
  isBlocking,
  resolveCitations,
  validateCitations,
} from "./citations.js";

export type {
  Account,
  Engine,
  EngineDecision,
  EngineReason,
  Plan,
  UserRole,
} from "./account.js";
export {
  canChooseEngine,
  canProcess,
  PLAN_DEFAULT_ENGINE,
  PLAN_MONTHLY_MINUTES,
  remainingMinutes,
  resolveEngine,
} from "./account.js";

export type {
  RawSegment,
  TranscriptionInput,
  TranscriptionProvider,
  TranscriptionResult,
} from "./transcription.js";
export { isUsableForRoleIdentification, speakerCount } from "./transcription.js";
