import path from "node:path";
import { getAIProviderConfig } from "./ai-provider.server";
import { getModel, getToolConfig } from "./models.server";
import { buildTools } from "./tools/index.server";
import { buildSystemPrompt } from "./prompts.server";
import { db } from "./db/index.server";
import { repositories } from "./db/schema";
import { eq } from "drizzle-orm";

export type { PendingQuestionData } from "./tools/ask-user-question.server";

const REPOS_BASE_DIR = process.env.REPOS_DIR || "/repos";

function getOrgReposDir(organizationId: string): string {
  return path.join(REPOS_BASE_DIR, organizationId);
}

function getRepoPath(organizationId: string, repoName: string): string {
  return path.join(getOrgReposDir(organizationId), repoName);
}

async function getAllRepos(organizationId: string) {
  return db
    .select({ name: repositories.name, cloneStatus: repositories.cloneStatus })
    .from(repositories)
    .where(eq(repositories.organizationId, organizationId));
}

export async function getAgentConfig(
  organizationId: string,
  memberId: string,
  signal?: AbortSignal,
) {
  const orgReposDir = getOrgReposDir(organizationId);
  const allRepos = await getAllRepos(organizationId);
  const completedRepos = allRepos.filter((r) => r.cloneStatus === "completed");
  const repoNames = completedRepos.map((r) => r.name);
  const repoStatuses = allRepos.map((r) => ({ name: r.name, status: r.cloneStatus }));

  const enabledTools = await getToolConfig(organizationId);

  const agentCwd =
    completedRepos.length === 1
      ? getRepoPath(organizationId, completedRepos[0].name)
      : orgReposDir;

  const { model, modelId } = await getModel(memberId, organizationId);
  const aiProviderConfig = await getAIProviderConfig(organizationId);

  const tools = buildTools({
    cwd: agentCwd,
    allowedDirs: [orgReposDir],
    signal,
    enabledTools,
    organizationId,
  });

  const systemPrompt = buildSystemPrompt(repoNames, repoStatuses);

  return {
    model,
    modelId,
    tools,
    systemPrompt,
    promptCachingEnabled: aiProviderConfig?.promptCachingEnabled !== false,
    provider: aiProviderConfig?.provider ?? ("anthropic" as const),
  };
}
