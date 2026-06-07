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

export const REPOS_BASE_DIR = process.env.REPOS_DIR || "/repos";

export function getOrgRepoDir(organizationId: string): string {
  return path.join(REPOS_BASE_DIR, organizationId);
}

export function getRepoPath(organizationId: string, repoName: string): string {
  return path.join(getOrgRepoDir(organizationId), repoName);
}

const PULL_TIMEOUT_MS = 60_000;

interface ExecGitOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

function execGit(
  args: string[],
  cwd?: string,
  options?: ExecGitOptions
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      signal: options?.signal,
      timeout: options?.timeoutMs,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code, killSignal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else if (killSignal && options?.timeoutMs) {
        reject(new Error(`git ${args[0]} timed out after ${Math.round(options.timeoutMs / 1000)}s`));
      } else if (killSignal) {
        reject(new Error(`git ${args[0]} terminated (${killSignal})`));
      } else {
        reject(new Error(`git ${args[0]} failed: ${stderr}`));
      }
    });

    proc.on("error", reject);
  });
}

const inFlightClones = new Map<string, Promise<void>>();

function withCloneLock(repoId: string, fn: () => Promise<void>): Promise<void> {
  const existing = inFlightClones.get(repoId);
  if (existing) return existing;
  const promise = fn().finally(() => {
    inFlightClones.delete(repoId);
  });
  inFlightClones.set(repoId, promise);
  return promise;
}

export function cloneRepository(
  organizationId: string,
  repoId: string,
  repoName: string,
  cloneUrl: string,
  signal?: AbortSignal
): Promise<void> {
  return withCloneLock(repoId, () =>
    doCloneRepository(organizationId, repoId, repoName, cloneUrl, signal)
  );
}

async function doCloneRepository(
  organizationId: string,
  repoId: string,
  repoName: string,
  cloneUrl: string,
  signal?: AbortSignal
): Promise<void> {
  const orgDir = getOrgRepoDir(organizationId);
  const repoPath = getRepoPath(organizationId, repoName);

  await db
    .update(repositories)
    .set({ cloneStatus: "cloning", lastSyncedAt: new Date() })
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

    await execGit(["clone", authCloneUrl, repoPath], undefined, { signal });

    await db
      .update(repositories)
      .set({
        cloneStatus: "completed",
        clonedAt: new Date(),
        lastSyncedAt: new Date(),
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

export function clonePublicRepository(
  organizationId: string,
  repoId: string,
  repoName: string,
  cloneUrl: string,
  signal?: AbortSignal
): Promise<void> {
  return withCloneLock(repoId, () =>
    doClonePublicRepository(organizationId, repoId, repoName, cloneUrl, signal)
  );
}

async function doClonePublicRepository(
  organizationId: string,
  repoId: string,
  repoName: string,
  cloneUrl: string,
  signal?: AbortSignal
): Promise<void> {
  const orgDir = getOrgRepoDir(organizationId);
  const repoPath = getRepoPath(organizationId, repoName);

  await db
    .update(repositories)
    .set({ cloneStatus: "cloning", lastSyncedAt: new Date() })
    .where(eq(repositories.id, repoId));

  try {
    if (!fs.existsSync(orgDir)) {
      fs.mkdirSync(orgDir, { recursive: true });
    }

    if (fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }

    await execGit(["clone", cloneUrl, repoPath], undefined, { signal });

    await db
      .update(repositories)
      .set({
        cloneStatus: "completed",
        clonedAt: new Date(),
        lastSyncedAt: new Date(),
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
  repoName: string,
  signal?: AbortSignal
): Promise<void> {
  const repoPath = getRepoPath(organizationId, repoName);

  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository not found: ${repoPath}`);
  }

  const accessToken = await getOrRefreshAccessToken(organizationId);
  if (!accessToken) {
    throw new Error("No access token available");
  }

  const gitOpts = { timeoutMs: PULL_TIMEOUT_MS, signal };

  const remoteUrl = (
    await execGit(["remote", "get-url", "origin"], repoPath, gitOpts)
  ).stdout.trim();
  const authUrl = getAuthenticatedCloneUrl(
    remoteUrl.replace(/x-access-token:[^@]+@/, ""),
    accessToken
  );

  await execGit(["remote", "set-url", "origin", authUrl], repoPath, gitOpts);

  try {
    const branch = (await execGit(["rev-parse", "--abbrev-ref", "HEAD"], repoPath, gitOpts)).stdout.trim();
    await execGit(["fetch", "--force", "--prune", "origin"], repoPath, gitOpts);
    await execGit(["reset", "--hard", `origin/${branch}`], repoPath, gitOpts);
  } finally {
    const cleanUrl = remoteUrl.replace(/x-access-token:[^@]+@/, "");
    await execGit(["remote", "set-url", "origin", cleanUrl], repoPath, {
      timeoutMs: 10_000,
    }).catch(() => {});
  }

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
  repoName: string,
  signal?: AbortSignal
): Promise<void> {
  const repoPath = getRepoPath(organizationId, repoName);

  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository not found: ${repoPath}`);
  }

  const gitOpts = { timeoutMs: PULL_TIMEOUT_MS, signal };

  const branch = (await execGit(["rev-parse", "--abbrev-ref", "HEAD"], repoPath, gitOpts)).stdout.trim();
  await execGit(["fetch", "--force", "--prune", "origin"], repoPath, gitOpts);
  await execGit(["reset", "--hard", `origin/${branch}`], repoPath, gitOpts);

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
