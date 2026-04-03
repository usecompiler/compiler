import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./db/index.server";
import { items } from "./db/schema";
import { eq } from "drizzle-orm";
import { isSaas, validateSaasEnv } from "./appMode.server";

async function startup() {
  validateSaasEnv();
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

  if (isSaas()) {
    try {
      const { Template } = await import("@e2b/code-interpreter");
      const { getTemplateName } = await import("./e2b/template.server");
      const name = getTemplateName();
      const exists = await Template.exists(name);
      if (!exists) {
        console.warn(`[startup] E2B template "${name}" not found. Run: npx tsx scripts/build-e2b-template.ts`);
      }
    } catch (error) {
      console.warn("[startup] Could not verify E2B template:", error);
    }
  }
}

export const ready = startup();
