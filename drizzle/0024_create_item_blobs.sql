CREATE TABLE "item_blobs" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"blob_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "item_blob_unique" ON "item_blobs" USING btree ("item_id","blob_id");--> statement-breakpoint
ALTER TABLE "item_blobs" ADD CONSTRAINT "item_blobs_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_blobs" ADD CONSTRAINT "item_blobs_blob_id_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blobs"("id") ON DELETE cascade ON UPDATE no action;
