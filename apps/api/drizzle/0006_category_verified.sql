ALTER TABLE "transactions" ADD COLUMN "category_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Categories set by hand before verification existed count as verified.
UPDATE "transactions" SET "category_verified" = true WHERE "category" IS NOT NULL AND "category_rule_id" IS NULL;
