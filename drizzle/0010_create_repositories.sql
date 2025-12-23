CREATE TABLE "repositories" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"github_repo_id" text,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"clone_url" text NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"clone_status" text DEFAULT 'pending' NOT NULL,
	"cloned_at" timestamp,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
