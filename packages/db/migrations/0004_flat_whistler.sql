ALTER TABLE "professionals" ADD COLUMN "voice_embedding" vector(256);--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "voice_enrolled_at" timestamp with time zone;