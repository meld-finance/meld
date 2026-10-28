ALTER TABLE "retirement_plan" ADD COLUMN "property_appreciation" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "retirement_plan" ADD COLUMN "selling_cost_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "retirement_plan" ADD COLUMN "properties" jsonb DEFAULT '[]'::jsonb NOT NULL;