CREATE TABLE "retirement_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"plan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retirement_simulations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"settings" jsonb NOT NULL,
	"inputs" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retirement_simulations" ADD CONSTRAINT "retirement_simulations_scenario_id_retirement_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."retirement_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retirement_scenarios_active_idx" ON "retirement_scenarios" USING btree ("active") WHERE "retirement_scenarios"."active";--> statement-breakpoint
INSERT INTO "retirement_scenarios" ("name", "active", "plan")
SELECT 'My plan', true, jsonb_build_object(
	'retirementAge', "retirement_age",
	'lifeExpectancy', "life_expectancy",
	'annualContribution', "annual_contribution",
	'expectedReturn', "expected_return",
	'annualSpending', "annual_spending",
	'spendingDeclinePercent', "spending_decline_percent",
	'socialSecurityAnnual', "social_security_annual",
	'socialSecurityAge', "social_security_age",
	'pensionAnnual', "pension_annual",
	'otherSavings', "other_savings",
	'propertyAppreciation', "property_appreciation",
	'sellingCostPercent', "selling_cost_percent",
	'excludedAccountIds', "excluded_account_ids",
	'properties', "properties",
	'spendingChanges', "spending_changes"
)
FROM "retirement_plan" WHERE "id" = 1;
