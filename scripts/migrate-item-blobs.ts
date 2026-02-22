import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { blobs, itemBlobs } from "../app/lib/db/schema";
import { isNotNull } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const connectionString =
  process.env.DATABASE_SSL === "true"
    ? dbUrl.includes("?")
      ? `${dbUrl}&sslmode=require`
      : `${dbUrl}?sslmode=require`
    : dbUrl;

const client = postgres(connectionString);
const db = drizzle(client);

async function migrate() {
  console.log("Migrating existing blob→item links to item_blobs join table...");

  const rows = await db
    .select({ id: blobs.id, itemId: blobs.itemId })
    .from(blobs)
    .where(isNotNull(blobs.itemId));

  console.log(`Found ${rows.length} blobs with itemId set.`);

  if (rows.length === 0) {
    console.log("Nothing to migrate.");
    await client.end();
    return;
  }

  const values = rows.map((row) => ({
    id: crypto.randomUUID(),
    itemId: row.itemId!,
    blobId: row.id,
  }));

  const BATCH_SIZE = 500;
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE);
    await db.insert(itemBlobs).values(batch).onConflictDoNothing();
    console.log(`Inserted ${Math.min(i + BATCH_SIZE, values.length)}/${values.length} item_blobs rows.`);
  }

  console.log("Migration complete.");
  await client.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
