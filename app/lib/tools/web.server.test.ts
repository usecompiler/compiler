import { describe, it, expect } from "vitest";
import { buildWebTools } from "./web.server";

const ALL_ENABLED = ["read", "bash", "websearch", "webfetch"];

function toolId(tool: unknown): string {
  return (tool as { id: string }).id;
}

describe("buildWebTools", () => {
  it("returns nothing for the bedrock provider", () => {
    expect(buildWebTools("bedrock", "claude-opus-5", ALL_ENABLED)).toEqual({});
  });

  it("returns nothing when neither web tool is enabled", () => {
    expect(buildWebTools("anthropic", "claude-opus-5", ["read", "bash"])).toEqual({});
  });

  it("builds only the enabled web tools", () => {
    const tools = buildWebTools("anthropic", "claude-opus-5", ["websearch"]);
    expect(Object.keys(tools)).toEqual(["web_search"]);
  });

  it("uses the modern variants on current-generation models", () => {
    const tools = buildWebTools("anthropic", "claude-opus-5", ALL_ENABLED);
    expect(toolId(tools.web_search)).toContain("20260209");
    expect(toolId(tools.web_fetch)).toContain("20260209");
  });

  it("uses the modern variants for dated snapshot ids", () => {
    const tools = buildWebTools("anthropic", "claude-sonnet-4-6-20260217", ALL_ENABLED);
    expect(toolId(tools.web_search)).toContain("20260209");
  });

  it("falls back to the basic variants on older models", () => {
    const tools = buildWebTools("anthropic", "claude-sonnet-4-5-20250929", ALL_ENABLED);
    expect(toolId(tools.web_search)).toContain("20250305");
    expect(toolId(tools.web_fetch)).toContain("20250910");
  });
});
