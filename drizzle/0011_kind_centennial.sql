CREATE TABLE "bank_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"imap_host" text NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"imap_user" text NOT NULL,
	"imap_password_enc" text NOT NULL,
	"imap_folder" text DEFAULT 'INBOX' NOT NULL,
	"from_filter" text DEFAULT 'servis@kbinfo.cz' NOT NULL,
	"subject_filter" text DEFAULT 'Přijali jsme platbu' NOT NULL,
	"account_number" text,
	"active" boolean DEFAULT true NOT NULL,
	"uid_validity" bigint,
	"last_uid" bigint,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "bank_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"message_id" text NOT NULL,
	"amount_haler" integer NOT NULL,
	"currency" text NOT NULL,
	"value_date" date NOT NULL,
	"from_account" text,
	"to_account" text,
	"vs" text,
	"ks" text,
	"ss" text,
	"message_for_recipient" text,
	"source_link" text,
	"raw_tokens" jsonb,
	"status" text NOT NULL,
	"status_reason" text,
	"duplicate_of_transaction_id" text,
	"matched_by" text,
	"payment_id" text,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_matching_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"counterparty_account" text,
	"vs" text,
	"ks" text,
	"ss" text,
	"amount_from_haler" integer,
	"amount_to_haler" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_integration" ADD CONSTRAINT "bank_integration_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_sync_run" ADD CONSTRAINT "bank_sync_run_integration_id_bank_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."bank_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_integration_id_bank_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."bank_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_duplicate_of_transaction_id_bank_transaction_id_fk" FOREIGN KEY ("duplicate_of_transaction_id") REFERENCES "public"."bank_transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matching_rule" ADD CONSTRAINT "payment_matching_rule_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_matching_rule" ADD CONSTRAINT "payment_matching_rule_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transaction_org_message_idx" ON "bank_transaction" USING btree ("org_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_matching_rule_contract_idx" ON "payment_matching_rule" USING btree ("contract_id");