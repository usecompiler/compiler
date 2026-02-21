import path from "node:path";
import { getAIProviderConfig } from "./ai-provider.server";
import { getModel, getToolConfig } from "./models.server";
import { buildTools } from "./tools/index.server";
import { buildSystemPrompt } from "./prompts.server";
import { db } from "./db/index.server";
import { repositories } from "./db/schema";
import { eq, and } from "drizzle-orm";

export type { PendingQuestionData } from "./tools/ask-user-question.server";

const REPOS_BASE_DIR = process.env.REPOS_DIR || "/repos";

function getOrgReposDir(organizationId: string): string {
  return path.join(REPOS_BASE_DIR, organizationId);
}

function getRepoPath(organizationId: string, repoName: string): string {
  return path.join(getOrgReposDir(organizationId), repoName);
}

async function getCompletedRepos(organizationId: string) {
  return db
    .select({ name: repositories.name })
    .from(repositories)
    .where(
      and(
        eq(repositories.organizationId, organizationId),
        eq(repositories.cloneStatus, "completed"),
      ),
    );
}

export async function getAgentConfig(
  organizationId: string,
  memberId: string,
  signal?: AbortSignal,
) {
  const orgReposDir = getOrgReposDir(organizationId);
  const completedRepos = await getCompletedRepos(organizationId);
  const repoNames = completedRepos.map((r) => r.name);

  const enabledTools = await getToolConfig(organizationId);

  const agentCwd =
    completedRepos.length === 1
      ? getRepoPath(organizationId, completedRepos[0].name)
      : orgReposDir;

  const { model, modelId } = await getModel(memberId, organizationId);
  const aiProviderConfig = await getAIProviderConfig(organizationId);
  const provider = aiProviderConfig?.provider ?? "anthropic";

  const tools = buildTools({
    cwd: agentCwd,
    allowedDirs: [orgReposDir],
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
  };
}
