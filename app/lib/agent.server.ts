import { streamText, stepCountIs, type ModelMessage } from "ai";
import path from "node:path";
import { getAIProviderConfig } from "./ai-provider.server";
import { getModel, getToolConfig } from "./models.server";
import { buildTools } from "./tools/index.server";
import {
  submitAnswer as toolSubmitAnswer,
  getPendingQuestion as toolGetPendingQuestion,
  cleanupPendingAnswers,
  type PendingQuestionData,
} from "./tools/ask-user-question.server";
import { isOverflow, compactMessages } from "./compaction.server";
import { buildSystemPrompt } from "./prompts.server";
import { db } from "./db/index.server";
import { repositories } from "./db/schema";
import { eq, and } from "drizzle-orm";

export type { PendingQuestionData } from "./tools/ask-user-question.server";

export function submitAnswer(conversationId: string, answers: Record<string, string>): boolean {
  return toolSubmitAnswer(conversationId, answers);
}

export function getPendingQuestion(conversationId: string): PendingQuestionData[] | null {
  return toolGetPendingQuestion(conversationId);
}

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


export interface AgentStats {
  toolUses: number;
  tokens: number;
  durationMs: number;
}

export interface AgentEvent {
  type:
    | "text"
    | "tool_use"
    | "tool_result"
    | "new_turn"
    | "result"
    | "error"
    | "done";
  content?: string;
  tool?: string;
  input?: unknown;
  stats?: AgentStats;
}

const TEXT_MEDIA_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/x-sh",
  "image/svg+xml",
]);

function isTextMediaType(mediaType: string): boolean {
  return TEXT_MEDIA_TYPES.has(mediaType);
}

function reconstructMessages(
  priorItems: Array<{ role: string | null; content: unknown }>,
  currentPrompt: string,
  images?: Array<{ base64: string; mediaType: string; filename?: string }>,
): ModelMessage[] {
  const messages: ModelMessage[] = [];

  const completedItems = priorItems.filter((item) => {
    return item.role === "user" || item.role === "assistant";
  });

  for (const item of completedItems) {
    if (item.role === "user") {
      const text =
        typeof item.content === "string"
          ? item.content
          : (item.content as { text?: string })?.text || "";
      if (text) {
        messages.push({ role: "user", content: text });
      }
    } else if (item.role === "assistant") {
      const text = (item.content as { text?: string })?.text || "";
      if (text) {
        messages.push({ role: "assistant", content: text });
      }
    }
  }

  if (images && images.length > 0) {
    const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
    const contentParts: Array<
      | { type: "text"; text: string }
      | { type: "image"; image: string; mediaType: string }
      | { type: "file"; data: string; mediaType: string }
    > = [];

    for (const img of images) {
      if (SUPPORTED_IMAGE_TYPES.has(img.mediaType)) {
        contentParts.push({
          type: "image",
          image: img.base64,
          mediaType: img.mediaType,
        });
      } else if (img.mediaType === "application/pdf") {
        contentParts.push({
          type: "file",
          data: img.base64,
          mediaType: img.mediaType,
        });
      } else if (img.mediaType.startsWith("text/") || isTextMediaType(img.mediaType)) {
        const text = Buffer.from(img.base64, "base64").toString("utf-8");
        contentParts.push({
          type: "text",
          text: `[File: ${img.filename || "file"}]\n${text}`,
        });
      } else {
        contentParts.push({
          type: "text",
          text: `[Attached file: ${img.filename || "file"} (${img.mediaType})]`,
        });
      }
    }

    contentParts.push({ type: "text", text: currentPrompt || "Describe this file." });
    messages.push({ role: "user", content: contentParts } as ModelMessage);
  } else {
    messages.push({ role: "user", content: currentPrompt });
  }

  return messages;
}

export async function* runAgent(
  prompt: string,
  organizationId: string,
  memberId: string,
  conversationId: string,
  signal?: AbortSignal,
  images?: Array<{ base64: string; mediaType: string; filename?: string }>,
  priorItems?: Array<{ role: string | null; content: unknown }>,
): AsyncGenerator<AgentEvent> {
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

  const tools = buildTools({
    cwd: agentCwd,
    allowedDirs: [orgReposDir],
    conversationId,
    signal,
    enabledTools,
  });

  let coreMessages = reconstructMessages(priorItems || [], prompt, images);
  const systemPrompt = buildSystemPrompt(repoNames);

  const startTime = Date.now();
  let toolUseCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    let stepCount = 0;

    const result = streamText({
      model,
      system: systemPrompt,
      messages: coreMessages,
      tools,
      stopWhen: stepCountIs(50),
      abortSignal: signal,
      onStepFinish: ({ usage }) => {
        if (usage) {
          totalInputTokens += usage.inputTokens || 0;
          totalOutputTokens += usage.outputTokens || 0;
        }
      },
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          yield { type: "text", content: part.text };
          break;

        case "tool-call":
          if (part.toolName !== "askUserQuestion") {
            toolUseCount++;
          }
          yield { type: "tool_use", tool: part.toolName, input: part.input };
          break;

        case "tool-result": {
          const resultText =
            typeof part.output === "string"
              ? part.output
              : JSON.stringify(part.output);
          const truncated =
            resultText.length > 500
              ? resultText.slice(0, 500) + "..."
              : resultText;
          yield { type: "tool_result", content: truncated };
          break;
        }

        case "finish-step":
          stepCount++;
          if (stepCount > 1) {
            yield { type: "new_turn" };
          }

          if (aiProviderConfig?.anthropicApiKey && isOverflow(totalInputTokens + totalOutputTokens, modelId)) {
            coreMessages = await compactMessages(coreMessages, aiProviderConfig.anthropicApiKey);
          }
          break;

        case "error":
          yield {
            type: "error",
            content: part.error instanceof Error ? part.error.message : String(part.error),
          };
          break;
      }
    }

    const durationMs = Date.now() - startTime;
    yield {
      type: "result",
      stats: {
        toolUses: toolUseCount,
        tokens: totalInputTokens + totalOutputTokens,
        durationMs,
      },
    };

    yield { type: "done" };
  } catch (error) {
    yield {
      type: "error",
      content: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    cleanupPendingAnswers(conversationId);
  }
}
