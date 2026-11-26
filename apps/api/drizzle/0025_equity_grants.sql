CREATE TABLE "equity_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'rsu' NOT NULL,
	"employer" text NOT NULL,
	"name" text NOT NULL,
	"ticker" text,
	"manual_price" numeric(18, 6),
	"price_as_of" date,
	"grant_date" date NOT NULL,
	"grant_number_mask" text,
	"total_shares" numeric(24, 8) NOT NULL,
	"linked_account_id" uuid,
	"withholding_method" text DEFAULT 'sell_to_cover' NOT NULL,
	"federal_withholding_rate" numeric(5, 2),
	"state_withholding_rate" numeric(5, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"document_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equity_vests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"vest_date" date NOT NULL,
	"shares" numeric(24, 8) NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"vest_price" numeric(18, 6),
	"shares_withheld" numeric(24, 8),
	"tax_withheld" numeric(18, 2),
	"matched_txn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "vested_quantity" numeric(24, 8);--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "vested_value" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "equity_grants" ADD CONSTRAINT "equity_grants_linked_account_id_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equity_grants" ADD CONSTRAINT "equity_grants_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equity_vests" ADD CONSTRAINT "equity_vests_grant_id_equity_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."equity_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equity_vests" ADD CONSTRAINT "equity_vests_matched_txn_id_investment_transactions_id_fk" FOREIGN KEY ("matched_txn_id") REFERENCES "public"."investment_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equity_vests_grant_date_idx" ON "equity_vests" USING btree ("grant_id","vest_date");--> statement-breakpoint
CREATE INDEX "equity_vests_date_idx" ON "equity_vests" USING btree ("vest_date");