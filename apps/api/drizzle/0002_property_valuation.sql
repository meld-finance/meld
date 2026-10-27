ALTER TABLE "manual_assets" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "manual_assets" ADD COLUMN "ownership_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "manual_assets" ADD COLUMN "valuation_sources" jsonb;