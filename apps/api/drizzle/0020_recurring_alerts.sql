CREATE TABLE "alert_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autopay_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payee_account_id" uuid NOT NULL,
	"funding_account_id" uuid NOT NULL,
	"amount_rule" text NOT NULL,
	"fixed_amount" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autopay_links_payee_account_id_unique" UNIQUE("payee_account_id")
);
--> statement-breakpoint
CREATE TABLE "recurring_overrides" (
	"key" text PRIMARY KEY NOT NULL,
	"ignored" boolean DEFAULT false NOT NULL,
	"kind" text,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "autopay_links" ADD CONSTRAINT "autopay_links_payee_account_id_accounts_id_fk" FOREIGN KEY ("payee_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopay_links" ADD CONSTRAINT "autopay_links_funding_account_id_accounts_id_fk" FOREIGN KEY ("funding_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_open_key_idx" ON "alerts" USING btree ("key") WHERE "alerts"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "alerts_created_idx" ON "alerts" USING btree ("created_at");