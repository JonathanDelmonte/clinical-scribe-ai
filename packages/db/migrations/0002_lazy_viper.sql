ALTER TABLE "sessions" ADD COLUMN "progress_percent" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "progress_phase" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "progress_eta_seconds" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "progress_preview" text;