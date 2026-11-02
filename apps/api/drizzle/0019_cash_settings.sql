CREATE TABLE "cash_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
