import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db/index.server", () => ({ db: {} }));
vi.mock("~/lib/ai-provider.server", () => ({ getAIProviderConfig: vi.fn() }));

import { getAgentEffort } from "./models.server";

describe("getAgentEffort", () => {
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
