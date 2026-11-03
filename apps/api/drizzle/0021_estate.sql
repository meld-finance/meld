CREATE TABLE "estate_designations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"manual_asset_id" uuid,
	"method" text NOT NULL,
	"beneficiaries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trust_id" uuid,
	"reviewed_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estate_designations_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "estate_designations_manual_asset_id_unique" UNIQUE("manual_asset_id")
);
--> statement-breakpoint
CREATE TABLE "estate_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"signed_date" date,
	"state" text,
	"reviewed_at" date,
	"original_location" text,
	"people" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attorney" jsonb,
	"document_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estate_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"settings" jsonb NOT NULL,
	"last_exported_at" timestamp with time zone,
	"export_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estate_designations" ADD CONSTRAINT "estate_designations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estate_designations" ADD CONSTRAINT "estate_designations_manual_asset_id_manual_assets_id_fk" FOREIGN KEY ("manual_asset_id") REFERENCES "public"."manual_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estate_designations" ADD CONSTRAINT "estate_designations_trust_id_estate_documents_id_fk" FOREIGN KEY ("trust_id") REFERENCES "public"."estate_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estate_documents" ADD CONSTRAINT "estate_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;