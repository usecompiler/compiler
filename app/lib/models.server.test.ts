import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db/index.server", () => ({ db: {} }));

const getAIProviderConfig = vi.fn();
vi.mock("~/lib/ai-provider.server", () => ({
  getAIProviderConfig: (...args: unknown[]) => getAIProviderConfig(...args),
}));

import { getAgentEffort, getAgentFallbacks, getAvailableClaudeModels, getTitleGenerationModel, clearModelCache, DEFAULT_MODEL_ID } from "./models.server";

describe("unconfigured provider", () => {
  it("throws a clear error instead of using an empty API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    getAIProviderConfig.mockResolvedValue(null);

    await expect(getTitleGenerationModel("org-1")).rejects.toThrow(/AI provider is not configured/);

    vi.unstubAllEnvs();
  });
});

describe("getAvailableClaudeModels caching", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    clearModelCache();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        data: [{ id: "claude-opus-5", display_name: "Claude Opus 5", created_at: "2026-07-24T00:00:00Z" }],
      })),
    );
    getAIProviderConfig.mockImplementation(async (organizationId: string) => ({
      provider: "anthropic",
      anthropicApiKey: `key-${organizationId}`,
    }));
  });

  it("caches per organization instead of a single slot", async () => {
    await getAvailableClaudeModels("org-1");
    await getAvailableClaudeModels("org-2");
    await getAvailableClaudeModels("org-1");
    await getAvailableClaudeModels("org-2");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches after clearModelCache", async () => {
    await getAvailableClaudeModels("org-1");
    clearModelCache();
    await getAvailableClaudeModels("org-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getAgentEffort", () => {
  it("returns xhigh for claude-opus-5 on anthropic", () => {
    expect(getAgentEffort("anthropic", "claude-opus-5")).toBe("xhigh");
  });

  it("returns xhigh for the default model", () => {
    expect(getAgentEffort("anthropic", DEFAULT_MODEL_ID)).toBe("xhigh");
  });

  it("returns xhigh for claude-opus-4-8 on anthropic", () => {
    expect(getAgentEffort("anthropic", "claude-opus-4-8")).toBe("xhigh");
  });

  it("returns xhigh for claude-opus-4-7 on anthropic", () => {
    expect(getAgentEffort("anthropic", "claude-opus-4-7")).toBe("xhigh");
  });

  it("returns xhigh for dated snapshot ids of supported models", () => {
    expect(getAgentEffort("anthropic", "claude-opus-4-8-20260528")).toBe("xhigh");
    expect(getAgentEffort("anthropic", "claude-opus-4-7-20260416")).toBe("xhigh");
  });

  it("returns undefined for models that do not support xhigh", () => {
    expect(getAgentEffort("anthropic", "claude-sonnet-4-6")).toBeUndefined();
    expect(getAgentEffort("anthropic", "claude-opus-4-6")).toBeUndefined();
    expect(getAgentEffort("anthropic", "claude-haiku-4-5-20251001")).toBeUndefined();
  });

  it("returns undefined for bedrock regardless of model", () => {
    expect(getAgentEffort("bedrock", "claude-opus-4-8")).toBeUndefined();
    expect(getAgentEffort("bedrock", "anthropic.claude-opus-4-8")).toBeUndefined();
  });
});

describe("getAgentFallbacks", () => {
  it("returns default for claude-opus-5 on anthropic", () => {
    expect(getAgentFallbacks("anthropic", "claude-opus-5")).toBe("default");
  });

  it("returns default for claude-fable-5 on anthropic", () => {
    expect(getAgentFallbacks("anthropic", "claude-fable-5")).toBe("default");
  });

  it("returns undefined for models without server-side fallbacks", () => {
    expect(getAgentFallbacks("anthropic", "claude-opus-4-8")).toBeUndefined();
    expect(getAgentFallbacks("anthropic", "claude-sonnet-4-6")).toBeUndefined();
  });

  it("returns undefined for bedrock regardless of model", () => {
    expect(getAgentFallbacks("bedrock", "claude-opus-5")).toBeUndefined();
  });
});
