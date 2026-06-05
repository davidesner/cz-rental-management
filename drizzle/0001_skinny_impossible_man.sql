CREATE TABLE "contract" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"property_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"security_deposit_haler" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_terms" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"base_rent_haler" integer NOT NULL,
	"service_advance_haler" integer NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_utility" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"kind" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"monthly_advance_haler" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_service_tariff" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"total_svj_advance_haler" integer NOT NULL,
	"deductible_amount_haler" integer NOT NULL,
	"deductible_note" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"account_number" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "reconciliation_skill" text;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_terms" ADD CONSTRAINT "contract_terms_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_utility" ADD CONSTRAINT "contract_utility_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_service_tariff" ADD CONSTRAINT "property_service_tariff_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;