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
import { isSaas } from "../appMode.server";
import { getOrRefreshAccessToken } from "../github.server";
import { getOrgRepos } from "../projects.server";
import type { Sandbox } from "@e2b/code-interpreter";

export const repoSyncDescription = `Check repository status or trigger cloning/pulling. Use action "status" to see which repos are available, cloning, or pending. Use action "sync" to clone pending repos or pull updates for stale repos. You should check status at the start of every conversation.`;

export const repoSyncParameters = z.object({
  action: z.enum(["status", "sync"]).describe("'status' to check repo state, 'sync' to clone/pull repos"),
  repoName: z.string().optional().describe("Sync a specific repo by name, or omit to sync all that need it"),
});

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

type RepoRow = Awaited<ReturnType<typeof getOrgRepos>>[number];

interface RepoSyncOptions {
  organizationId: string;
  projectId?: string | null;
  sandbox?: Sandbox;
  accessToken?: string | null;
}

async function syncSingleRepo(
  repo: RepoRow,
  options: RepoSyncOptions,
): Promise<string> {
  const { organizationId, sandbox } = options;

  if (repo.cloneStatus === "cloning") {
    return `${repo.name}: currently cloning, please wait`;
  }

  const onDisk = !isSaas() && repoExists(organizationId, repo.name);
  const needsClone = repo.cloneStatus === "pending" || repo.cloneStatus === "failed" || (!isSaas() && !onDisk);

  if (needsClone) {
    try {
      if (isSaas() && sandbox) {
        const accessToken = repo.isPrivate ? options.accessToken : null;
        const cloneOpts: Parameters<typeof sandbox.git.clone>[1] = {
          path: `/repos/${repo.name}`,
          timeoutMs: 300_000,
        };
        if (repo.isPrivate && accessToken) {
          cloneOpts.username = "x-access-token";
          cloneOpts.password = accessToken;
        }
        await sandbox.git.clone(repo.cloneUrl, cloneOpts);
        await db
          .update(repositories)
          .set({ cloneStatus: "completed", clonedAt: new Date() })
          .where(eq(repositories.id, repo.id));
      } else if (repo.isPrivate) {
        await cloneRepository(organizationId, repo.id, repo.name, repo.cloneUrl);
      } else {
        await clonePublicRepository(organizationId, repo.id, repo.name, repo.cloneUrl);
      }
      return `${repo.name}: cloned successfully`;
    } catch (error) {
      return `${repo.name}: clone failed - ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  if (repo.cloneStatus === "completed") {
    const lastSync = repo.lastSyncedAt || repo.clonedAt;
    const isStale = !lastSync || Date.now() - lastSync.getTime() > STALE_THRESHOLD_MS;

    if (isStale) {
      try {
        if (isSaas() && sandbox) {
          const safeName = "'" + repo.name.replace(/'/g, "'\\''") + "'";
          await sandbox.commands.run(`cd /repos/${safeName} && git fetch --force --prune origin && git reset --hard origin/$(git rev-parse --abbrev-ref HEAD)`, { timeoutMs: 60_000 });
          await db
            .update(repositories)
            .set({ lastSyncedAt: new Date() })
            .where(eq(repositories.id, repo.id));
        } else if (repo.isPrivate) {
          await pullRepository(organizationId, repo.name);
        } else {
          await pullPublicRepository(organizationId, repo.name);
        }
        return `${repo.name}: pulled latest changes`;
      } catch (error) {
        return `${repo.name}: pull failed - ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    return `${repo.name}: up to date`;
  }

  return `${repo.name}: status ${repo.cloneStatus}`;
}

export async function executeRepoSync(
  args: z.infer<typeof repoSyncParameters>,
  options: RepoSyncOptions,
): Promise<string> {
  const repos = await getOrgRepos(options.organizationId, options.projectId);

  if (repos.length === 0) {
    return "No repositories configured for this project.";
  }

  if (args.action === "status") {
    const lines = repos.map((repo) => {
      const lastSync = repo.lastSyncedAt || repo.clonedAt;
      const parts = [`${repo.name}: ${repo.cloneStatus}`];
      if (lastSync) {
        const ago = Math.round((Date.now() - lastSync.getTime()) / 60_000);
        parts.push(`last synced ${ago}m ago`);
      }
      return parts.join(" ");
    });
    return lines.join("\n");
  }

  if (args.action === "sync") {
    const targets = args.repoName
      ? repos.filter((r) => r.name === args.repoName)
      : repos;

    if (targets.length === 0) {
      return `Repository "${args.repoName}" not found in this project.`;
    }

    let accessToken: string | null = null;
    if (isSaas() && targets.some((r) => r.isPrivate)) {
      accessToken = await getOrRefreshAccessToken(options.organizationId);
    }
    const syncOptions = { ...options, accessToken };

    const results = await Promise.all(
      targets.map((repo) => syncSingleRepo(repo, syncOptions)),
    );
    return results.join("\n");
  }

  return "Unknown action.";
}
