CREATE TYPE "public"."document_type" AS ENUM('clinical_note', 'prescription', 'referral', 'patient_summary', 'custom_objective');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'pro', 'clinic');--> statement-breakpoint
CREATE TYPE "public"."role_source" AS ENUM('llm', 'voice_match', 'manual', 'channel');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('draft', 'recording', 'uploaded', 'transcribing', 'generating', 'ready_for_review', 'approved', 'failed');--> statement-breakpoint
CREATE TYPE "public"."speaker_role" AS ENUM('professional', 'patient', 'other', 'unknown');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"professional_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"content" jsonb NOT NULL,
	"model" text,
	"prompt_version" text,
	"citation_issues" jsonb,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "objective_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid,
	"specialty" text,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"name" text NOT NULL,
	"birth_date" timestamp,
	"document_encrypted" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "professionals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"specialty" text,
	"professional_registry" text,
	"signature_url" text,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"status" "session_status" DEFAULT 'draft' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"audio_path" text,
	"audio_deleted_at" timestamp with time zone,
	"objective_text" text,
	"objective_template_id" uuid,
	"consent_recorded_at" timestamp with time zone,
	"consent_method" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"speaker_label" text NOT NULL,
	"role" "speaker_role" DEFAULT 'unknown' NOT NULL,
	"role_source" "role_source" DEFAULT 'llm' NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"text" text NOT NULL,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" text NOT NULL,
	"minutes" real,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objective_templates" ADD CONSTRAINT "objective_templates_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_professional_idx" ON "audit_log" USING btree ("professional_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_session_idx" ON "documents" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "documents_professional_idx" ON "documents" USING btree ("professional_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "templates_owner_idx" ON "objective_templates" USING btree ("professional_id","specialty");--> statement-breakpoint
CREATE INDEX "patients_professional_idx" ON "patients" USING btree ("professional_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "professionals_auth_user_idx" ON "professionals" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "sessions_professional_idx" ON "sessions" USING btree ("professional_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_patient_idx" ON "sessions" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "segments_session_idx" ON "transcript_segments" USING btree ("session_id","start_ms");--> statement-breakpoint
CREATE INDEX "segments_professional_idx" ON "transcript_segments" USING btree ("professional_id");--> statement-breakpoint
CREATE INDEX "usage_professional_idx" ON "usage_events" USING btree ("professional_id","created_at");