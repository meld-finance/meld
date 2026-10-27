CREATE TABLE "category_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern" text NOT NULL,
	"category" text NOT NULL,
	"subcategory" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "subcategory" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_rule_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "category_rules_pattern_idx" ON "category_rules" USING btree (lower("pattern"));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_rule_id_category_rules_id_fk" FOREIGN KEY ("category_rule_id") REFERENCES "public"."category_rules"("id") ON DELETE set null ON UPDATE no action;