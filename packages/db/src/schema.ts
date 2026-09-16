/**
 * Schema do banco — tradução de §9 da DOCUMENTACAO.md para tabelas.
 *
 * REGRA INEGOCIÁVEL: toda tabela que contém dado de paciente carrega
 * `professionalId` DIRETO, mesmo quando ele seria derivável por JOIN.
 *
 * Por quê: as políticas RLS são a única barreira real entre os dados de um
 * profissional e os de outro — a documentação (§6.3) exige isolamento "no
 * nível de dados, não só na interface". Política com JOIN é lenta e fácil de
 * escrever errado, e cada política errada é vazamento de dado de saúde. Com a
 * coluna direta, toda política vira a mesma linha:
 *
 *     using (professional_id = auth.professional_id())
 *
 * A redundância de uma coluna é um preço baixo por isso. Ver sql/rls.sql.
 */

import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

/**
 * Cargo e plano são eixos SEPARADOS, de propósito.
 *
 * A alternativa tentadora — um enum só, com `medico_gratis | medico_pro |
 * desenvolvedor` — explode em combinações a cada plano novo, e nela
 * "desenvolvedor" fica sem plano nenhum. Dois eixos independentes cobrem tudo
 * e não crescem um em cima do outro. Ver packages/core/src/account.ts.
 */
export const userRoleEnum = pgEnum("user_role", ["professional", "developer"]);

export const planEnum = pgEnum("plan", ["free", "pro", "clinic"]);

/** Motor de processamento. Nomeado pelo que é, não pelo que custa. */
export const engineEnum = pgEnum("engine", ["local", "cloud"]);

export const speakerRoleEnum = pgEnum("speaker_role", [
  "professional",
  "patient",
  "other",
  "unknown",
]);

/** Como o papel foi determinado. Alimenta a decisão do Marco 3 sobre adotar
 *  ou não o Método A (impressão vocal). */
export const roleSourceEnum = pgEnum("role_source", [
  "llm",
  "voice_match",
  "manual",
  "channel",
]);

export const sessionStatusEnum = pgEnum("session_status", [
  "draft",
  "recording",
  "uploaded",
  "transcribing",
  "generating",
  "ready_for_review",
  "approved",
  "failed",
]);

export const documentTypeEnum = pgEnum("document_type", [
  "clinical_note",
  "prescription",
  "referral",
  "patient_summary",
  "custom_objective",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "done",
  "failed",
]);

// -----------------------------------------------------------------------------
// Profissional — o tenant
// -----------------------------------------------------------------------------

export const professionals = pgTable(
  "professionals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** FK lógica para auth.users do Supabase. */
    authUserId: uuid("auth_user_id").notNull(),
    name: text("name").notNull(),
    /** "nutrição", "psicologia", "clínica médica"… define o template da nota. */
    specialty: text("specialty"),
    /** CRM, CRN, CRP… guardamos o número como texto; o conselho varia. */
    professionalRegistry: text("professional_registry"),
    signatureUrl: text("signature_url"),

    role: userRoleEnum("role").notNull().default("professional"),
    plan: planEnum("plan").notNull().default("free"),

    /**
     * Preferência persistente de motor. **Só tem efeito para `developer`** —
     * `resolveEngine()` descarta a preferência de quem não pode escolher.
     *
     * A coluna existe para todos porque a permissão é regra de negócio, não
     * de schema: um NOT NULL condicional aqui não impediria nada e tornaria a
     * migração mais difícil quando surgir um terceiro cargo.
     */
    preferredEngine: engineEnum("preferred_engine"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    // voiceEmbedding: vector("voice_embedding", { dimensions: 192 })
    //   → só adicionar se o Marco 3 mostrar que o Método B (classificação por
    //     conteúdo) fica abaixo de ~95% de acurácia. Cadastrar amostra de voz
    //     é fricção no onboarding; não pague esse custo antes de precisar.
  },
  (t) => [uniqueIndex("professionals_auth_user_idx").on(t.authUserId)],
);

// -----------------------------------------------------------------------------
// Paciente
// -----------------------------------------------------------------------------

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    birthDate: timestamp("birth_date", { withTimezone: false, mode: "date" }),
    /** CPF/RG cifrado na aplicação. Nunca em claro — é identificador direto. */
    documentEncrypted: text("document_encrypted"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("patients_professional_idx").on(t.professionalId, t.name)],
);

// -----------------------------------------------------------------------------
// Sessão — uma consulta gravada
// -----------------------------------------------------------------------------

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),

    status: sessionStatusEnum("status").notNull().default("draft"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),

    /** Caminho no Storage. O áudio NUNCA fica no banco. */
    audioPath: text("audio_path"),
    /** Apagado conforme AUDIO_RETENTION_DAYS — minimização, LGPD Art. 6º. */
    audioDeletedAt: timestamp("audio_deleted_at", { withTimezone: true }),

    /** O "objetivo" da sessão — o coração do produto (§1 da documentação). */
    objectiveText: text("objective_text"),
    objectiveTemplateId: uuid("objective_template_id"),

    /**
     * Motor PEDIDO para esta sessão. Nulo = usa o padrão do plano.
     * Só respeitado quando o dono é `developer`.
     */
    engineChoice: engineEnum("engine_choice"),

    /**
     * Motor efetivamente USADO. Preenchido pelo worker ao processar.
     *
     * Duas colunas em vez de uma porque pedido e realizado divergem: uma
     * sessão pode pedir `cloud` e rodar em `local` porque a permissão não
     * permitia, ou porque o fornecedor caiu e houve queda para o local. Sem
     * as duas, você não consegue auditar nem o custo nem a divergência.
     */
    engineUsed: engineEnum("engine_used"),

    /**
     * Registro de ciência da gravação. A base legal do tratamento é a tutela
     * da saúde (LGPD Art. 11, II, "f"), não o consentimento — mas a
     * transparência é obrigatória: o paciente precisa estar ciente (§10).
     */
    consentRecordedAt: timestamp("consent_recorded_at", { withTimezone: true }),
    consentMethod: text("consent_method"),

    failureReason: text("failure_reason"),

    /**
     * Andamento do processamento, para a tela de espera.
     *
     * Fica na sessão, e não só na memória do worker, por dois motivos: a
     * interface consulta o banco (não tem acesso ao worker), e se o worker
     * cair no meio o último estado conhecido sobrevive — a tela mostra onde
     * parou em vez de voltar ao zero sem explicação.
     *
     * `progressPreview` guarda o último pedaço de texto reconhecido. É o que
     * transforma a espera de "uma barra andando" em "está funcionando, olha aí
     * o que ele já entendeu".
     */
    /**
     * Quem é quem, e por quê.
     *
     * Guarda a decisão de papel junto com a EVIDÊNCIA que a sustenta — os
     * sinais encontrados no texto. Mesma disciplina das citações: o
     * profissional precisa poder ver por que o sistema decidiu, e discordar.
     *
     * Fica na sessão e não só nos trechos porque a decisão é sobre o FALANTE,
     * não sobre cada fala. Repetir confiança e evidência em 197 linhas seria
     * redundância que dessincroniza na primeira correção manual.
     */
    roleAssignment: jsonb("role_assignment"),

    progressPercent: integer("progress_percent"),
    progressPhase: text("progress_phase"),
    progressEtaSeconds: integer("progress_eta_seconds"),
    progressPreview: text("progress_preview"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("sessions_professional_idx").on(t.professionalId, t.createdAt),
    index("sessions_patient_idx").on(t.patientId, t.createdAt),
    index("sessions_status_idx").on(t.status),
  ],
);

// -----------------------------------------------------------------------------
// Transcrição
// -----------------------------------------------------------------------------

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    /** Este é o ID que o LLM cita. Opaco e estável de propósito — ver
     *  packages/core/src/citations.ts. */
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** ⚑ Desnormalizado para que a política RLS não precise de JOIN. */
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),

    /** Rótulo cru da diarização, ex.: "SPEAKER_00". */
    speakerLabel: text("speaker_label").notNull(),
    role: speakerRoleEnum("role").notNull().default("unknown"),
    roleSource: roleSourceEnum("role_source").notNull().default("llm"),

    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    text: text("text").notNull(),
    confidence: real("confidence"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // embedding: vector("embedding", { dimensions: 1536 })
    //   → Fase 4 (assistente RAG, §6.3-A). pgvector já está habilitado; é uma
    //     coluna e um índice, sem migração de dados históricos.
  },
  (t) => [
    index("segments_session_idx").on(t.sessionId, t.startMs),
    index("segments_professional_idx").on(t.professionalId),
  ],
);

// -----------------------------------------------------------------------------
// Documentos gerados
// -----------------------------------------------------------------------------

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),

    type: documentTypeEnum("type").notNull(),

    /**
     * Conteúdo estruturado. Cada afirmação clínica carrega `sources: string[]`
     * com IDs de transcript_segments — ver CitedStatement em @scribe/core.
     */
    content: jsonb("content").notNull(),

    /** Modelo e versão do prompt que produziram isto. Sem estes dois campos
     *  você não consegue investigar uma regressão de qualidade depois. */
    model: text("model"),
    promptVersion: text("prompt_version"),

    /** Problemas de citação detectados na geração (CitationIssue[]).
     *  Nota com problema bloqueante nunca chega ao profissional como pronta. */
    citationIssues: jsonb("citation_issues"),

    /** Nasce como rascunho. Nada vira documento sem clique explícito (§11). */
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_session_idx").on(t.sessionId),
    index("documents_professional_idx").on(t.professionalId, t.createdAt),
  ],
);

// -----------------------------------------------------------------------------
// Biblioteca de objetivos (§5.3 da documentação)
// -----------------------------------------------------------------------------

export const objectiveTemplates = pgTable(
  "objective_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** NULO = template global, visível a todos. Ver política em rls.sql. */
    professionalId: uuid("professional_id").references(() => professionals.id, {
      onDelete: "cascade",
    }),
    specialty: text("specialty"),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("templates_owner_idx").on(t.professionalId, t.specialty)],
);

// -----------------------------------------------------------------------------
// Uso e custo — a instrumentação que o freemium exige (§11 do plano)
// -----------------------------------------------------------------------------

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    professionalId: uuid("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    /** "asr" | "llm_note" | "llm_verify" | "storage" */
    kind: text("kind").notNull(),
    minutes: real("minutes"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    /** Custo real em centavos de real. Registre desde o primeiro usuário —
     *  sem isso você descobre que o plano grátis sangra tarde demais. */
    costCents: integer("cost_cents").notNull().default(0),
    provider: text("provider"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_professional_idx").on(t.professionalId, t.createdAt)],
);

// -----------------------------------------------------------------------------
// Auditoria — requisito de prontuário eletrônico (§10, NGS1)
// -----------------------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    professionalId: uuid("professional_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_professional_idx").on(t.professionalId, t.createdAt)],
);

// -----------------------------------------------------------------------------
// Fila de processamento
// -----------------------------------------------------------------------------

/**
 * Fila em tabela, consumida com `FOR UPDATE SKIP LOCKED`.
 *
 * Não é preguiça: Postgres com SKIP LOCKED sustenta milhares de jobs/dia sem
 * transpirar, e evita um Redis ou SQS a mais para operar, observar e pagar.
 * Troque por fila dedicada quando o volume provar que precisa — não antes.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    professionalId: uuid("professional_id").notNull(),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    /** "transcribe" | "identify_roles" | "generate_note" | "delete_audio" */
    kind: text("kind").notNull(),
    payload: jsonb("payload"),
    status: jobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    /** Backoff exponencial: o worker só pega jobs com runAfter <= now(). */
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_claim_idx").on(t.status, t.runAfter)],
);
