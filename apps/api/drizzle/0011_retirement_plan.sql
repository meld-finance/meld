CREATE TABLE "retirement_plan" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"retirement_age" integer,
	"life_expectancy" integer,
	"annual_contribution" numeric(18, 2),
	"expected_return" numeric(5, 2),
	"annual_spending" numeric(18, 2),
	"social_security_annual" numeric(18, 2),
	"social_security_age" integer,
	"pension_annual" numeric(18, 2),
	"other_savings" numeric(18, 2),
	"excluded_account_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
