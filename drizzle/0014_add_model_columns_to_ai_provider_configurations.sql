ALTER TABLE "ai_provider_configurations" ADD COLUMN "available_models" jsonb DEFAULT '["claude-sonnet-4-20250514"]';
--> statement-breakpoint
ALTER TABLE "ai_provider_configurations" ADD COLUMN "default_model" text DEFAULT 'claude-sonnet-4-20250514';
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "preferred_model" text;
