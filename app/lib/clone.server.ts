import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { db } from "./db/index.server";
import { repositories } from "./db/schema";
import { eq, and } from "drizzle-orm";
import {
  getOrRefreshAccessToken,
  getAuthenticatedCloneUrl,
} from "./github.server";

const REPOS_BASE_DIR = process.env.REPOS_DIR || "/repos";

function getOrgRepoDir(organizationId: string): string {
  return path.join(REPOS_BASE_DIR, organizationId);
}

function getRepoPath(organizationId: string, repoName: string): string {
  return path.join(getOrgRepoDir(organizationId), repoName);
}

function execGit(
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`git ${args[0]} failed: ${stderr}`));
      }
    });

    proc.on("error", reject);
  });
}

export async function cloneRepository(
  organizationId: string,
  repoId: string,
  repoName: string,
  cloneUrl: string
): Promise<void> {
  const orgDir = getOrgRepoDir(organizationId);
  const repoPath = getRepoPath(organizationId, repoName);

  await db
    .update(repositories)
    .set({ cloneStatus: "cloning" })
    .where(eq(repositories.id, repoId));

  try {
    if (!fs.existsSync(orgDir)) {
      fs.mkdirSync(orgDir, { recursive: true });
    }

    if (fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }

    const accessToken = await getOrRefreshAccessToken(organizationId);
    if (!accessToken) {
      throw new Error("No access token available");
    }

    const authCloneUrl = getAuthenticatedCloneUrl(cloneUrl, accessToken);

    await execGit(["clone", authCloneUrl, repoPath]);

    await db
      .update(repositories)
      .set({
        cloneStatus: "completed",
        clonedAt: new Date(),
      })
      .where(eq(repositories.id, repoId));
  } catch (error) {
    await db
      .update(repositories)
      .set({ cloneStatus: "failed" })
      .where(eq(repositories.id, repoId));
    throw error;
  }
}

export async function clonePublicRepository(
  organizationId: string,
  repoId: string,
  repoName: string,
  cloneUrl: string
): Promise<void> {
  const orgDir = getOrgRepoDir(organizationId);
  const repoPath = getRepoPath(organizationId, repoName);

  await db
    .update(repositories)
    .set({ cloneStatus: "cloning" })
    .where(eq(repositories.id, repoId));

  try {
    if (!fs.existsSync(orgDir)) {
      fs.mkdirSync(orgDir, { recursive: true });
    }

    if (fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }

    await execGit(["clone", cloneUrl, repoPath]);

    await db
      .update(repositories)
      .set({
        cloneStatus: "completed",
        clonedAt: new Date(),
      })
      .where(eq(repositories.id, repoId));
  } catch (error) {
    await db
      .update(repositories)
      .set({ cloneStatus: "failed" })
      .where(eq(repositories.id, repoId));
    throw error;
  }
}

export async function pullRepository(
  organizationId: string,
  repoName: string
): Promise<void> {
  const repoPath = getRepoPath(organizationId, repoName);

  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository not found: ${repoPath}`);
  }

  const accessToken = await getOrRefreshAccessToken(organizationId);
  if (!accessToken) {
    throw new Error("No access token available");
  }

  const remoteUrl = (
    await execGit(["remote", "get-url", "origin"], repoPath)
  ).stdout.trim();
  const authUrl = getAuthenticatedCloneUrl(
    remoteUrl.replace(/x-access-token:[^@]+@/, ""),
    accessToken
  );

  await execGit(["remote", "set-url", "origin", authUrl], repoPath);
  await execGit(["pull", "--ff-only"], repoPath);

  const cleanUrl = remoteUrl.replace(/x-access-token:[^@]+@/, "");
  await execGit(["remote", "set-url", "origin", cleanUrl], repoPath);

  const repo = await db
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.organizationId, organizationId),
        eq(repositories.name, repoName)
      )
    )
    .limit(1);

  if (repo.length > 0) {
    await db
      .update(repositories)
      .set({ lastSyncedAt: new Date() })
      .where(eq(repositories.id, repo[0].id));
  }
}

export async function pullPublicRepository(
  organizationId: string,
  repoName: string
): Promise<void> {
  const repoPath = getRepoPath(organizationId, repoName);

  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository not found: ${repoPath}`);
  }

  await execGit(["pull", "--ff-only"], repoPath);

  const repo = await db
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.organizationId, organizationId),
        eq(repositories.name, repoName)
      )
    )
    .limit(1);

  if (repo.length > 0) {
    await db
      .update(repositories)
      .set({ lastSyncedAt: new Date() })
      .where(eq(repositories.id, repo[0].id));
  }
}

export async function deleteRepository(
  organizationId: string,
  repoId: string,
  repoName: string
): Promise<void> {
  const repoPath = getRepoPath(organizationId, repoName);

  if (fs.existsSync(repoPath)) {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }

  await db.delete(repositories).where(eq(repositories.id, repoId));
}

export function repoExists(organizationId: string, repoName: string): boolean {
  const repoPath = getRepoPath(organizationId, repoName);
  return fs.existsSync(path.join(repoPath, ".git"));
}

export async function triggerRepoSync(organizationId: string): Promise<void> {
  const allRepos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.organizationId, organizationId));

  for (const repo of allRepos) {
    const existsOnDisk = repoExists(organizationId, repo.name);

    if (repo.cloneStatus === "cloning") {
      continue;
    }

    if (!existsOnDisk || repo.cloneStatus === "pending" || repo.cloneStatus === "failed") {
      if (repo.isPrivate) {
        cloneRepository(organizationId, repo.id, repo.name, repo.cloneUrl).catch((err) =>
          console.error(`[triggerRepoSync] Clone failed for ${repo.name}:`, err),
        );
      } else {
        clonePublicRepository(organizationId, repo.id, repo.name, repo.cloneUrl).catch((err) =>
          console.error(`[triggerRepoSync] Clone failed for ${repo.name}:`, err),
        );
      }
      continue;
    }

    if (existsOnDisk && repo.cloneStatus === "completed") {
      const lastSync = repo.lastSyncedAt || repo.clonedAt;
      const staleThreshold = 5 * 60 * 1000;
      if (!lastSync || Date.now() - lastSync.getTime() > staleThreshold) {
        if (repo.isPrivate) {
          pullRepository(organizationId, repo.name).catch((err) =>
            console.error(`[triggerRepoSync] Pull failed for ${repo.name}:`, err),
          );
        } else {
          pullPublicRepository(organizationId, repo.name).catch((err) =>
            console.error(`[triggerRepoSync] Pull failed for ${repo.name}:`, err),
          );
        }
      }
    }
  }
}
