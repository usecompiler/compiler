import path from "node:path";
import { getAIProviderConfig } from "./ai-provider.server";
import { getModel, getToolConfig } from "./models.server";
import { buildTools } from "./tools/index.server";
import { buildSystemPrompt } from "./prompts.server";
import { db } from "./db/index.server";
import { repositories, projectRepositories } from "./db/schema";
import { eq, and, asc } from "drizzle-orm";

export type { PendingQuestionData } from "./tools/ask-user-question.server";

const REPOS_BASE_DIR = process.env.REPOS_DIR || "/repos";

function getOrgReposDir(organizationId: string): string {
  return path.join(REPOS_BASE_DIR, organizationId);
}

function getRepoPath(organizationId: string, repoName: string): string {
  return path.join(getOrgReposDir(organizationId), repoName);
}

async function getCompletedReposForProject(
  organizationId: string,
  projectId?: string | null,
) {
  if (projectId) {
    return db
      .select({ name: repositories.name })
      .from(projectRepositories)
      .innerJoin(repositories, eq(projectRepositories.repositoryId, repositories.id))
      .where(
        and(
          eq(projectRepositories.projectId, projectId),
          eq(repositories.cloneStatus, "completed"),
        ),
      )
      .orderBy(asc(repositories.name));
  }

  return db
    .select({ name: repositories.name })
    .from(repositories)
    .where(
      and(
        eq(repositories.organizationId, organizationId),
        eq(repositories.cloneStatus, "completed"),
      ),
    )
    .orderBy(asc(repositories.name));
}

export async function getAgentConfig(
  organizationId: string,
  projectId: string | null,
  memberId: string,
  signal?: AbortSignal,
) {
  const orgReposDir = getOrgReposDir(organizationId);
  const completedRepos = await getCompletedReposForProject(organizationId, projectId);
  const repoNames = completedRepos.map((r) => r.name);

  const enabledTools = await getToolConfig(organizationId);

  const agentCwd =
    completedRepos.length === 1
      ? getRepoPath(organizationId, completedRepos[0].name)
      : orgReposDir;

  const { model, modelId } = await getModel(memberId, organizationId);
  const aiProviderConfig = await getAIProviderConfig(organizationId);
  const provider = aiProviderConfig?.provider ?? "anthropic";

  const allowedDirs = repoNames.length > 0
    ? repoNames.map((name) => getRepoPath(organizationId, name))
    : [orgReposDir];

  const tools = buildTools({
    cwd: agentCwd,
    allowedDirs,
    signal,
    enabledTools,
  });

  const systemPrompt = buildSystemPrompt(repoNames);

  return {
    model,
    modelId,
    provider,
    tools,
    systemPrompt,
    promptCachingEnabled: aiProviderConfig?.promptCachingEnabled !== false,
    compactionEnabled: aiProviderConfig?.compactionEnabled !== false,
  };
}
