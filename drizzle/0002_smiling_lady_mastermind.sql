CREATE TABLE "cost_statement" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"kind" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"total_amount_haler" integer NOT NULL,
	"adjustment_amount_haler" integer DEFAULT 0 NOT NULL,
	"adjustment_note" text,
	"document_ref" text,
	"issued_at" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"contract_id" text,
	"amount_haler" integer NOT NULL,
	"paid_at" date NOT NULL,
	"counterparty" text,
	"counterparty_account" text,
	"external_id" text,
	"statement_ref" text,
	"source" text NOT NULL,
	"description" text,
	"note" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_statement" ADD CONSTRAINT "cost_statement_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_statement" ADD CONSTRAINT "cost_statement_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_org_external_idx" ON "payment" USING btree ("org_id","external_id");