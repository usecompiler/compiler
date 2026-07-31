import { anthropic } from "@ai-sdk/anthropic";
import type { Tool } from "ai";

const anthropicTools = anthropic.tools;

type AnyTool = Tool<any, any>;

const MODERN_WEB_TOOL_MODELS = [
  "claude-opus-5",
  "claude-fable-5",
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
];

const MAX_USES = 10;

function supportsModernWebTools(modelId: string): boolean {
  return MODERN_WEB_TOOL_MODELS.some((m) => modelId === m || modelId.startsWith(`${m}-`));
}

export function buildWebTools(
  provider: string,
  modelId: string,
  enabledTools: string[],
): Record<string, AnyTool> {
  if (provider !== "anthropic") {
    return {};
  }

  const modern = supportsModernWebTools(modelId);
  const tools: Record<string, AnyTool> = {};

  if (enabledTools.includes("websearch")) {
    tools.web_search = modern
      ? anthropicTools.webSearch_20260209({ maxUses: MAX_USES })
      : anthropicTools.webSearch_20250305({ maxUses: MAX_USES });
  }

  if (enabledTools.includes("webfetch")) {
    tools.web_fetch = modern
      ? anthropicTools.webFetch_20260209({ maxUses: MAX_USES })
      : anthropicTools.webFetch_20250910({ maxUses: MAX_USES });
  }

  return tools;
}
