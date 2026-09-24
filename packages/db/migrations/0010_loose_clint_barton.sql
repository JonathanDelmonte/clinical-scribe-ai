ALTER TABLE "sessions" ADD COLUMN "second_channel_path" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "channel_diarization" jsonb;