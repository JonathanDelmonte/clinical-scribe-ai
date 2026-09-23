ALTER TABLE "transcript_segments" ADD COLUMN "text_original" text;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "role_original" "speaker_role";--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "corrected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "corrected_by" uuid;