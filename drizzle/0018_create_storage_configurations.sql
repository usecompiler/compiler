CREATE TABLE "storage_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"bucket" text NOT NULL,
	"region" text,
	"encrypted_access_key_id" text NOT NULL,
	"access_key_id_iv" text NOT NULL,
	"encrypted_secret_access_key" text NOT NULL,
	"secret_access_key_iv" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "storage_configurations_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "storage_configurations" ADD CONSTRAINT "storage_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
