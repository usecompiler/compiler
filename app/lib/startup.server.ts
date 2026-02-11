import { db } from "./db/index.server";
import { items } from "./db/schema";
import { eq } from "drizzle-orm";

async function cleanupStaleItems() {
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

cleanupStaleItems();
