ALTER TABLE "sessions" ADD COLUMN "silence_removed_ms" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "speech_regions" jsonb;