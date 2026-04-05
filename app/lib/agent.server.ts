import { getAIProviderConfig } from "./ai-provider.server";
import { getModel, getToolConfig } from "./models.server";
import { buildTools } from "./tools/index.server";
import { buildSystemPrompt, COMPACTION_INSTRUCTIONS } from "./prompts.server";
import { isSaas } from "./appMode.server";
import { getOrCreateSandbox } from "./e2b/sandbox-manager.server";
import { buildSandboxTools } from "./e2b/sandbox-tools.server";
import { getOrgRepoDir, getRepoPath } from "./clone.server";
import { getOrgRepos } from "./projects.server";

export type { PendingQuestionData } from "./tools/ask-user-question.server";

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

  const allRepos = await getOrgRepos(organizationId, projectId);
  const allRepoInfo = allRepos.map((r) => ({ name: r.name, cloneStatus: r.cloneStatus }));

  if (isSaas() && projectId) {
    const sandbox = await getOrCreateSandbox(projectId, organizationId);
    repoNames = allRepos.map((r) => r.name);

    const agentCwd = repoNames.length === 1
      ? `/repos/${repoNames[0]}`
      : "/repos";

    tools = buildSandboxTools({
      sandbox,
      cwd: agentCwd,
      enabledTools,
      organizationId,
      projectId,
    });
  } else {
    const orgReposDir = getOrgRepoDir(organizationId);
    const completedRepos = allRepos.filter((r) => r.cloneStatus === "completed");
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
      organizationId,
      projectId,
    });
  }

  return {
    model,
    modelId,
    provider,
    tools,
    systemPrompt: buildSystemPrompt(allRepoInfo),
    promptCachingEnabled: aiProviderConfig?.promptCachingEnabled !== false,
    compactionEnabled: aiProviderConfig?.compactionEnabled !== false,
    compactionInstructions: COMPACTION_INSTRUCTIONS,
  };
}
