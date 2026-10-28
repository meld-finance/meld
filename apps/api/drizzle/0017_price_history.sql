CREATE TABLE "price_history" (
	"ticker" text PRIMARY KEY NOT NULL,
	"closes" jsonb,
	"fetched_at" timestamp with time zone NOT NULL
);
