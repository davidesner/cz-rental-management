CREATE TABLE "reconciliation" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_item" (
	"id" text PRIMARY KEY NOT NULL,
	"reconciliation_id" text NOT NULL,
	"kind" text NOT NULL,
	"actual_cost_haler" integer NOT NULL,
	"paid_haler" integer NOT NULL,
	"difference_haler" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_item" ADD CONSTRAINT "reconciliation_item_reconciliation_id_reconciliation_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."reconciliation"("id") ON DELETE cascade ON UPDATE no action;