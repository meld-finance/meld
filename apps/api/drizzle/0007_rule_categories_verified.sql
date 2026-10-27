-- A rule's category counts as verified.
UPDATE "transactions" SET "category_verified" = true WHERE "category_rule_id" IS NOT NULL;
