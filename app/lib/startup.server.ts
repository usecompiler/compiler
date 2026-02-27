import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./db/index.server";
import { items } from "./db/schema";
import { eq } from "drizzle-orm";

async function startup() {
  try {
    console.log("[startup] Running database migrations...");
    await migrate(db, { migrationsFolder: "drizzle" });
    console.log("[startup] Migrations complete");
  } catch (error) {
    console.error("[startup] Failed to run migrations:", error);
    throw error;
  }

  try {
    const stale = await db
      .update(items)
      .set({ status: "cancelled" })
      .where(eq(items.status, "in_progress"))
      .returning({ id: items.id });

    if (stale.length > 0) {
      console.log(`[startup] Cleaned up ${stale.length} stale in_progress item(s)`);
    }
  } catch (error) {
    console.error("[startup] Failed to cleanup stale items:", error);
  }
}

export const ready = startup();
