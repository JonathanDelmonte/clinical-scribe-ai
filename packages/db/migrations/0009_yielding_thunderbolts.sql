ALTER TABLE "professionals" ADD COLUMN "llm_provider" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "llm_model" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "llm_key_cipher" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "llm_key_hint" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "llm_base_url" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "llm_data_policy" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "llm_verified_at" timestamp with time zone;