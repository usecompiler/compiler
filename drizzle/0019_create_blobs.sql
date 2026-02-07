CREATE TABLE "blobs" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"organization_id" text NOT NULL,
	"item_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "blobs_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;
