CREATE TABLE "helpers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"pairing_nonce" text NOT NULL,
	"name" text NOT NULL,
	"version" text,
	"device" text,
	"ready" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" text PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "helper_id" uuid;--> statement-breakpoint
ALTER TABLE "helpers" ADD CONSTRAINT "helpers_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "helpers_token_idx" ON "helpers" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "helpers_pairing_idx" ON "helpers" USING btree ("pairing_nonce");--> statement-breakpoint
CREATE INDEX "helpers_professional_idx" ON "helpers" USING btree ("professional_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_helper_id_helpers_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."helpers"("id") ON DELETE set null ON UPDATE no action;