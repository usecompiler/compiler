import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db/index.server", () => ({ db: {} }));

const getAIProviderConfig = vi.fn();
vi.mock("~/lib/ai-provider.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/ai-provider.server")>()),
  getAIProviderConfig: (...args: unknown[]) => getAIProviderConfig(...args),
}));

const getModel = vi.fn();
const getToolConfig = vi.fn().mockResolvedValue([]);
vi.mock("~/lib/models.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/models.server")>()),
  getModel: (...args: unknown[]) => getModel(...args),
  getToolConfig: (...args: unknown[]) => getToolConfig(...args),
}));

vi.mock("~/lib/tools/index.server", () => ({ buildTools: vi.fn(() => ({})) }));
vi.mock("~/lib/prompts.server", () => ({
  buildSystemPrompt: vi.fn(() => "system prompt"),
  COMPACTION_INSTRUCTIONS: "compaction instructions",
}));
vi.mock("~/lib/appMode.server", () => ({ isSaas: vi.fn(() => false) }));
vi.mock("~/lib/e2b/sandbox-manager.server", () => ({ getOrCreateSandbox: vi.fn() }));
vi.mock("~/lib/e2b/sandbox-tools.server", () => ({ buildSandboxTools: vi.fn(() => ({})) }));
vi.mock("~/lib/clone.server", () => ({
  getOrgRepoDir: vi.fn(() => "/repos/org-1"),
  getRepoPath: vi.fn((org: string, name: string) => `/repos/${org}/${name}`),
}));
const getOrgRepos = vi.fn().mockResolvedValue([]);
vi.mock("~/lib/projects.server", () => ({
  getOrgRepos: (...args: unknown[]) => getOrgRepos(...args),
}));

import { getAgentConfig } from "./agent.server";

beforeEach(() => {
  vi.clearAllMocks();
  getToolConfig.mockResolvedValue([]);
  getOrgRepos.mockResolvedValue([]);
});

describe("getAgentConfig effort wiring", () => {
  it("returns xhigh effort for an anthropic org on claude-opus-4-8", async () => {
    getModel.mockResolvedValue({ model: "mock-model", modelId: "claude-opus-4-8" });
    getAIProviderConfig.mockResolvedValue({ provider: "anthropic", anthropicApiKey: "key" });

    const config = await getAgentConfig("org-1", null, "member-1");

    expect(config.modelId).toBe("claude-opus-4-8");
    expect(config.effort).toBe("xhigh");
  });

  it("returns no effort for an anthropic org on claude-sonnet-4-6", async () => {
    getModel.mockResolvedValue({ model: "mock-model", modelId: "claude-sonnet-4-6" });
    getAIProviderConfig.mockResolvedValue({ provider: "anthropic", anthropicApiKey: "key" });

    const config = await getAgentConfig("org-1", null, "member-1");

    expect(config.effort).toBeUndefined();
  });

  it("returns no effort for a bedrock org even on claude-opus-4-8", async () => {
    getModel.mockResolvedValue({ model: "mock-model", modelId: "claude-opus-4-8" });
    getAIProviderConfig.mockResolvedValue({
      provider: "bedrock",
      awsRegion: "us-east-1",
      awsAccessKeyId: "AKID",
      awsSecretAccessKey: "SECRET",
    });

    const config = await getAgentConfig("org-1", null, "member-1");

    expect(config.provider).toBe("bedrock");
    expect(config.effort).toBeUndefined();
  });

  it("defaults provider to anthropic and returns xhigh when no provider config exists", async () => {
    getModel.mockResolvedValue({ model: "mock-model", modelId: "claude-opus-4-8" });
    getAIProviderConfig.mockResolvedValue(null);

    const config = await getAgentConfig("org-1", null, "member-1");

    expect(config.provider).toBe("anthropic");
    expect(config.effort).toBe("xhigh");
  });
});
