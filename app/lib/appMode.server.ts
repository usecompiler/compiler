import { db } from "./db/index.server";
import { members } from "./db/schema";
import { eq } from "drizzle-orm";

export type AppMode = "saas" | "self-hosted";

export function getAppMode(): AppMode {
  return process.env.APP_MODE === "saas" ? "saas" : "self-hosted";
}

export function isSelfHosted(): boolean {
  return getAppMode() === "self-hosted";
}

export async function isSetupComplete(): Promise<boolean> {
  const result = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.role, "owner"))
    .limit(1);
  return result.length > 0;
}
