import path from "node:path";
import { getAIProviderConfig } from "./ai-provider.server";
import { getModel, getToolConfig } from "./models.server";
import { buildTools } from "./tools/index.server";
import { buildSystemPrompt, COMPACTION_INSTRUCTIONS } from "./prompts.server";
import { db } from "./db/index.server";
import { repositories, projectRepositories } from "./db/schema";
import { eq, and, asc } from "drizzle-orm";
import { isSaas } from "./appMode.server";
import { getOrCreateSandbox } from "./e2b/sandbox-manager.server";
import { buildSandboxTools } from "./e2b/sandbox-tools.server";

export type { PendingQuestionData } from "./tools/ask-user-question.server";

const REPOS_BASE_DIR = process.env.REPOS_DIR || "/repos";

function getOrgReposDir(organizationId: string): string {
  return path.join(REPOS_BASE_DIR, organizationId);
}

function getRepoPath(organizationId: string, repoName: string): string {
  return path.join(getOrgReposDir(organizationId), repoName);
}

async function getReposForProject(
  organizationId: string,
  projectId?: string | null,
  filterCompleted = true,
) {
  const statusFilter = filterCompleted
    ? eq(repositories.cloneStatus, "completed")
    : undefined;

  if (projectId) {
    return db
      .select({ name: repositories.name })
      .from(projectRepositories)
      .innerJoin(repositories, eq(projectRepositories.repositoryId, repositories.id))
      .where(
        statusFilter
          ? and(eq(projectRepositories.projectId, projectId), statusFilter)
          : eq(projectRepositories.projectId, projectId),
      )
      .orderBy(asc(repositories.name));
  }

  return db
    .select({ name: repositories.name })
    .from(repositories)
    .where(
      statusFilter
        ? and(eq(repositories.organizationId, organizationId), statusFilter)
        : eq(repositories.organizationId, organizationId),
    )
    .orderBy(asc(repositories.name));
}

export async function getAgentConfig(
  organizationId: string,
  projectId: string | null,
  memberId: string,
  signal?: AbortSignal,
) {
  const [{ model, modelId }, aiProviderConfig, enabledTools] = await Promise.all([
    getModel(memberId, organizationId),
    getAIProviderConfig(organizationId),
    getToolConfig(organizationId),
  ]);
  const provider = aiProviderConfig?.provider ?? "anthropic";

  let tools;
  let repoNames: string[];

  if (isSaas() && projectId) {
    const sandbox = await getOrCreateSandbox(projectId, organizationId);
    const repos = await getReposForProject(organizationId, projectId, false);
    repoNames = repos.map((r) => r.name);

    const agentCwd = repoNames.length === 1
      ? `/repos/${repoNames[0]}`
      : "/repos";

    tools = buildSandboxTools({
      sandbox,
      cwd: agentCwd,
      enabledTools,
    });
  } else {
    const orgReposDir = getOrgReposDir(organizationId);
    const completedRepos = await getReposForProject(organizationId, projectId);
    repoNames = completedRepos.map((r) => r.name);

    const agentCwd =
      completedRepos.length === 1
        ? getRepoPath(organizationId, completedRepos[0].name)
        : orgReposDir;

    const allowedDirs = repoNames.length > 0
      ? repoNames.map((name) => getRepoPath(organizationId, name))
      : [orgReposDir];

    tools = buildTools({
      cwd: agentCwd,
      allowedDirs,
      signal,
      enabledTools,
    });
  }

  return {
    model,
    modelId,
    provider,
    tools,
    systemPrompt: buildSystemPrompt(repoNames),
    promptCachingEnabled: aiProviderConfig?.promptCachingEnabled !== false,
    compactionEnabled: aiProviderConfig?.compactionEnabled !== false,
    compactionInstructions: COMPACTION_INSTRUCTIONS,
  };
}
