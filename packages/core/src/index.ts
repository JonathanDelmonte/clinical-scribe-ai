export type {
  CitedStatement,
  DocumentType,
  SessionStatus,
  SpeakerRole,
  SpeakerRoleSource,
  TranscriptSegment,
} from "./domain";
export { SPEAKER_ROLES } from "./domain";

export type { CitationIssue } from "./citations";
export {
  formatSegmentsForPrompt,
  formatTimestamp,
  isBlocking,
  resolveCitations,
  validateCitations,
} from "./citations";

export type {
  Account,
  Engine,
  EngineDecision,
  EngineReason,
  Plan,
  UserRole,
} from "./account";
export {
  canChooseEngine,
  canProcess,
  PLAN_DEFAULT_ENGINE,
  PLAN_MONTHLY_MINUTES,
  remainingMinutes,
  resolveEngine,
} from "./account";

export type {
  EngineProgress,
  RawSegment,
  TranscriptionInput,
  TranscriptionProvider,
  TranscriptionResult,
} from "./transcription";
export { isUsableForRoleIdentification, speakerCount } from "./transcription";

export type {
  RoleEvidence,
  SpeakerAssignment,
  SpeakerInput,
  VoiceRefinement,
  VoiceScoredSegment,
} from "./roles";
export {
  identifyRolesByContent,
  MIN_CONFIDENCE,
  MARGEM_VOZ,
  refineRolesByVoice,
  SEPARACAO_MINIMA_VOZ,
  roleByLabel,
  swapRoles,
} from "./roles";

export type {
  ApprovalCheck,
  ClinicalNote,
  NoteSection,
  NoteValidation,
  ParsedNote,
  ReviewedStatement,
  SecaoChave,
} from "./note";
export {
  allStatements,
  buildNotePrompt,
  checkApproval,
  parseNoteResponse,
  PROMPT_VERSION,
  NOTE_RESPONSE_SCHEMA,
  SECOES,
  sectionTitle,
  validateNote,
} from "./note";

export type { LlmCompletion, LlmDataPolicy, LlmProvider, LlmUsage } from "./llm";
export { checkDataPolicy, dataPolicyLabel } from "./llm";

export type { ObjectiveItem, ObjectiveSpec, ParsedObjective } from "./objective";
export {
  buildObjectivePrompt,
  countGaps,
  objetivoPorSlug,
  OBJETIVOS_GLOBAIS,
  parseObjectiveResponse,
  PROMPT_VERSION_OBJETIVO,
  validateObjective,
} from "./objective";
