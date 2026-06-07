CREATE TABLE "rent_reduction" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"for_month" date NOT NULL,
	"amount_haler" integer NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rent_reduction" ADD CONSTRAINT "rent_reduction_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_reduction" ADD CONSTRAINT "rent_reduction_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rent_reduction_contract_month_idx" ON "rent_reduction" USING btree ("contract_id","for_month");