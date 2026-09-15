CREATE TYPE "public"."engine" AS ENUM('local', 'cloud');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('professional', 'developer');--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "role" "user_role" DEFAULT 'professional' NOT NULL;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "preferred_engine" "engine";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "engine_choice" "engine";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "engine_used" "engine";