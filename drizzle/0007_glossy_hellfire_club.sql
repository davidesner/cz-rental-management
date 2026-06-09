ALTER TABLE "contract_terms" ADD COLUMN "payment_due_day" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_terms" ADD COLUMN "payment_applies_to" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
UPDATE "contract_terms" AS ct SET "payment_due_day" = c."payment_due_day", "payment_applies_to" = c."payment_applies_to" FROM "contract" AS c WHERE ct."contract_id" = c."id";--> statement-breakpoint
ALTER TABLE "contract" DROP COLUMN "payment_due_day";--> statement-breakpoint
ALTER TABLE "contract" DROP COLUMN "payment_applies_to";
