import { Sandbox } from "@e2b/code-interpreter";
import crypto from "node:crypto";
import { db } from "../db/index.server";
import { projectSandboxes, repositories } from "../db/schema";
import { eq } from "drizzle-orm";
import { getOrRefreshAccessToken } from "../github.server";
import { getProjectRepos } from "../projects.server";
import { getTemplateName } from "./template.server";

const SANDBOX_TIMEOUT_MS = parseInt(
  process.env.E2B_SANDBOX_TIMEOUT_MS || "1800000",
  10,
);

const activeSandboxes = new Map<string, Sandbox>();

async function provisionSandbox(
  projectId: string,
  organizationId: string,
): Promise<Sandbox> {
  await db
    .update(projectSandboxes)
    .set({ status: "creating", updatedAt: new Date() })
    .where(eq(projectSandboxes.projectId, projectId));

  try {
    const sandbox = await Sandbox.create(getTemplateName(), {
      timeoutMs: SANDBOX_TIMEOUT_MS,
      metadata: { projectId, organizationId },
      lifecycle: {
        onTimeout: "pause",
        autoResume: true,
      },
    });

    const repos = await getProjectRepos(projectId, organizationId);

    let accessToken: string | null = null;
    const hasPrivateRepos = repos.some((r) => r.isPrivate);
    if (hasPrivateRepos) {
      accessToken = await getOrRefreshAccessToken(organizationId);
    }

    await Promise.all(
      repos.map(async (repo) => {
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
      }),
    );

    await db
      .update(projectSandboxes)
      .set({
        sandboxId: sandbox.sandboxId,
        status: "running",
        updatedAt: new Date(),
      })
      .where(eq(projectSandboxes.projectId, projectId));

    activeSandboxes.set(projectId, sandbox);
    return sandbox;
  } catch (error) {
    await db
      .update(projectSandboxes)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(projectSandboxes.projectId, projectId));
    throw error;
  }
}

export async function getOrCreateSandbox(
  projectId: string,
  organizationId: string,
): Promise<Sandbox> {
  const cached = activeSandboxes.get(projectId);
  if (cached) {
    return cached;
  }

  const records = await db
    .select()
    .from(projectSandboxes)
    .where(eq(projectSandboxes.projectId, projectId))
    .limit(1);

  if (records.length === 0) {
    await db.insert(projectSandboxes).values({
      id: crypto.randomUUID(),
      projectId,
      status: "pending",
    });
    return provisionSandbox(projectId, organizationId);
  }

  const record = records[0];

  if (record.status === "pending" || record.status === "error" || record.status === "creating") {
    return provisionSandbox(projectId, organizationId);
  }

  if (record.sandboxId) {
    try {
      const sandbox = await Sandbox.connect(record.sandboxId);
      activeSandboxes.set(projectId, sandbox);
      return sandbox;
    } catch {
      return provisionSandbox(projectId, organizationId);
    }
  }

  return provisionSandbox(projectId, organizationId);
}

export async function destroySandbox(projectId: string): Promise<void> {
  const record = await db
    .select({ sandboxId: projectSandboxes.sandboxId })
    .from(projectSandboxes)
    .where(eq(projectSandboxes.projectId, projectId))
    .limit(1);

  if (record.length > 0 && record[0].sandboxId) {
    try {
      const cached = activeSandboxes.get(projectId);
      const sandbox = cached || await Sandbox.connect(record[0].sandboxId);
      await sandbox.kill();
    } catch {
      // Sandbox may already be dead
    }
  }

  activeSandboxes.delete(projectId);

  await db
    .delete(projectSandboxes)
    .where(eq(projectSandboxes.projectId, projectId));
}
