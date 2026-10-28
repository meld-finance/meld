ALTER TABLE "securities" ADD COLUMN "subtype" text;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "sector" text;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "profile" jsonb;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "profiled_at" timestamp with time zone;