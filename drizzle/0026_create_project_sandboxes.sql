CREATE TABLE "project_sandboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"sandbox_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_sandboxes_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "ai_provider_configurations" ALTER COLUMN "available_models" SET DEFAULT '["claude-sonnet-4-6"]'::jsonb;--> statement-breakpoint
ALTER TABLE "ai_provider_configurations" ALTER COLUMN "default_model" SET DEFAULT 'claude-sonnet-4-6';--> statement-breakpoint
ALTER TABLE "project_sandboxes" ADD CONSTRAINT "project_sandboxes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
