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

export function isSaas(): boolean {
  return getAppMode() === "saas";
}

const REQUIRED_SAAS_ENV_VARS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_SLUG",
  "GITHUB_APP_PRIVATE_KEY",
  "E2B_API_KEY",
  "ANTHROPIC_API_KEY",
];

export function validateSaasEnv(): void {
  if (!isSaas()) return;

  const missing = REQUIRED_SAAS_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `SaaS mode requires these environment variables: ${missing.join(", ")}`,
    );
  }
}

export async function isSetupComplete(): Promise<boolean> {
  const result = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.role, "owner"))
    .limit(1);
  return result.length > 0;
}
