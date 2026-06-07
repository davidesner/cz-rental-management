ALTER TABLE "contract" ADD COLUMN "payment_due_day" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "contract" ADD COLUMN "payment_applies_to" text DEFAULT 'current' NOT NULL;