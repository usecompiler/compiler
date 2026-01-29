ALTER TABLE "ai_provider_configurations" ALTER COLUMN "available_models" SET DEFAULT '["claude-sonnet-4-20250514"]'::jsonb;--> statement-breakpoint
ALTER TABLE "ai_provider_configurations" ADD COLUMN "prompt_caching_enabled" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "ai_provider_configurations" ADD COLUMN "allowed_tools" jsonb DEFAULT '["Bash"]'::jsonb;
