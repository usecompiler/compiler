import { z } from "zod";
import { db } from "../db/index.server";
import { repositories } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  cloneRepository,
  clonePublicRepository,
  pullRepository,
  pullPublicRepository,
  repoExists,
} from "../clone.server";

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 2 * 60 * 1000;
const DEFAULT_STALE_MINUTES = 5;

export const syncReposDescription = `Check the status of all repositories and sync them if needed. Call this tool before exploring any code to ensure repositories are cloned and up to date. This will trigger cloning for any repos that aren't on disk yet and pull updates for stale repos.`;

export const syncReposParameters = z.object({});

export async function executeSyncRepos(
  _args: z.infer<typeof syncReposParameters>,
  options: { organizationId: string },
): Promise<string> {
  const { organizationId } = options;

  const allRepos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.organizationId, organizationId));

  if (allRepos.length === 0) {
    return "No repositories are configured for this organization.";
  }

  const needsClone: string[] = [];
  const needsPull: string[] = [];
  const alreadyCloning: string[] = [];

  const now = Date.now();
  const staleThreshold = DEFAULT_STALE_MINUTES * 60 * 1000;

  for (const repo of allRepos) {
    const existsOnDisk = repoExists(organizationId, repo.name);

    if (repo.cloneStatus === "cloning") {
      alreadyCloning.push(repo.name);
      continue;
    }

    if (!existsOnDisk || repo.cloneStatus === "pending" || repo.cloneStatus === "failed") {
      needsClone.push(repo.name);
      continue;
    }

    if (repo.cloneStatus === "completed") {
      const lastSync = repo.lastSyncedAt || repo.clonedAt;
      if (!lastSync || now - lastSync.getTime() > staleThreshold) {
        needsPull.push(repo.name);
      }
    }
  }

  for (const repo of allRepos.filter((r) => needsClone.includes(r.name))) {
    try {
      if (repo.isPrivate) {
        cloneRepository(organizationId, repo.id, repo.name, repo.cloneUrl).catch((err) =>
          console.error(`[syncRepos] Clone failed for ${repo.name}:`, err),
        );
      } else {
        clonePublicRepository(organizationId, repo.id, repo.name, repo.cloneUrl).catch((err) =>
          console.error(`[syncRepos] Clone failed for ${repo.name}:`, err),
        );
      }
    } catch (err) {
      console.error(`[syncRepos] Failed to start clone for ${repo.name}:`, err);
    }
  }

  for (const repo of allRepos.filter((r) => needsPull.includes(r.name))) {
    try {
      if (repo.isPrivate) {
        pullRepository(organizationId, repo.name).catch((err) =>
          console.error(`[syncRepos] Pull failed for ${repo.name}:`, err),
        );
      } else {
        pullPublicRepository(organizationId, repo.name).catch((err) =>
          console.error(`[syncRepos] Pull failed for ${repo.name}:`, err),
        );
      }
    } catch (err) {
      console.error(`[syncRepos] Failed to start pull for ${repo.name}:`, err);
    }
  }

  const pendingRepoNames = [...needsClone, ...alreadyCloning];

  if (pendingRepoNames.length > 0) {
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const currentRepos = await db
        .select({ name: repositories.name, cloneStatus: repositories.cloneStatus })
        .from(repositories)
        .where(eq(repositories.organizationId, organizationId));

      const stillPending = currentRepos.filter(
        (r) =>
          pendingRepoNames.includes(r.name) &&
          (r.cloneStatus === "pending" || r.cloneStatus === "cloning"),
      );

      if (stillPending.length === 0) {
        break;
      }
    }
  }

  if (needsPull.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const finalRepos = await db
    .select({ name: repositories.name, cloneStatus: repositories.cloneStatus })
    .from(repositories)
    .where(eq(repositories.organizationId, organizationId));

  const ready = finalRepos.filter((r) => r.cloneStatus === "completed" && repoExists(organizationId, r.name));
  const failed = finalRepos.filter((r) => r.cloneStatus === "failed");
  const stillSyncing = finalRepos.filter(
    (r) => r.cloneStatus === "pending" || r.cloneStatus === "cloning",
  );

  const lines: string[] = [];

  if (ready.length > 0) {
    lines.push(`Ready: ${ready.map((r) => r.name).join(", ")}`);
  }

  if (failed.length > 0) {
    lines.push(`Failed: ${failed.map((r) => r.name).join(", ")} — these repos could not be synced. The user should check their GitHub connection settings.`);
  }

  if (stillSyncing.length > 0) {
    lines.push(`Still syncing (timed out waiting): ${stillSyncing.map((r) => r.name).join(", ")}`);
  }

  if (lines.length === 0) {
    return "No repositories found.";
  }

  return lines.join("\n");
}
