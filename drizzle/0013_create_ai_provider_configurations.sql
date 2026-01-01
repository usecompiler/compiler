CREATE TABLE "ai_provider_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_anthropic_api_key" text,
	"anthropic_api_key_iv" text,
	"aws_region" text,
	"encrypted_aws_access_key_id" text,
	"aws_access_key_id_iv" text,
	"encrypted_aws_secret_access_key" text,
	"aws_secret_access_key_iv" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_configurations_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "ai_provider_configurations" ADD CONSTRAINT "ai_provider_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
