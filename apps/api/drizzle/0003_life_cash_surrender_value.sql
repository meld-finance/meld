ALTER TABLE "insurance_policies" ADD COLUMN "cash_surrender_value" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "loan_balance" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "values_as_of" date;