ALTER TABLE "contract" ADD COLUMN "auto_renew" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contract" ADD COLUMN "renewal_months" integer;