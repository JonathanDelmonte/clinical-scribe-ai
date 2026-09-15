/**
 * API pública do pacote.
 *
 * Exportações nomeadas em vez de `export * from "./schema"`: o Turbopack não
 * segue o re-export através da extensão `.js` que o TypeScript exige com
 * `moduleResolution: nodenext`, e o sintoma é obscuro — "Export professionals
 * doesn't exist", num arquivo onde ele visivelmente existe.
 *
 * O efeito colateral é bom: a superfície do pacote passa a ser uma decisão, não
 * um acidente de qual arquivo exporta o quê.
 */

// Tabelas
export {
  auditLog,
  documents,
  jobs,
  objectiveTemplates,
  patients,
  professionals,
  sessions,
  transcriptSegments,
  usageEvents,
} from "./schema";

// Enums
export {
  documentTypeEnum,
  engineEnum,
  jobStatusEnum,
  planEnum,
  roleSourceEnum,
  sessionStatusEnum,
  speakerRoleEnum,
  userRoleEnum,
} from "./schema";

// Conexões
export {
  createAppClient,
  createServiceClient,
  withProfessional,
  type Database,
} from "./client";
