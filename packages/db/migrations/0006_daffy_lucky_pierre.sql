ALTER TABLE "professionals" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "consent_text" text;--> statement-breakpoint
CREATE UNIQUE INDEX "professionals_email_idx" ON "professionals" USING btree ("email");