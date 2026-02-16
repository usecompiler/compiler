import type { Route } from "./+types/api.agent";
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { getAgentConfig } from "~/lib/agent.server";
import { requireActiveAuth } from "~/lib/auth.server";
import { syncStaleRepos } from "~/lib/clone.server";
import { db } from "~/lib/db/index.server";
import { conversations, items, blobs } from "~/lib/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getStorageConfig, fetchFile } from "~/lib/storage.server";
import { itemsToUIMessages } from "~/components/conversation-helpers";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const user = await requireActiveAuth(request);
  if (!user.organization) {
    return new Response("Organization required", { status: 403 });
  }

  const body = await request.json();
  const message: UIMessage | undefined = body.message;
  const conversationId: string | undefined = body.conversationId;
  const blobIds: string[] | undefined = body.blobIds;

  if (!message || !conversationId) {
    return new Response("Missing message or conversationId", { status: 400 });
  }

  const isToolResultResubmit = message.role === "assistant";

  const userText = isToolResultResubmit
    ? ""
    : (message.parts
        ?.filter((p: { type: string }) => p.type === "text")
        .map((p: { type: string; text?: string }) => (p as { text: string }).text)
        .join("") || "");

  if (!isToolResultResubmit && !userText.trim() && (!blobIds || blobIds.length === 0)) {
    return new Response("Missing prompt", { status: 400 });
  }

  const organizationId = user.organization.id;
  const memberId = user.membership?.id;

  if (!memberId) {
    return new Response("Member not found", { status: 403 });
  }

  const conv = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      userId: conversations.userId,
    })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)));

  if (conv.length === 0) {
    return new Response("Conversation not found", { status: 404 });
  }

  if (!isToolResultResubmit) {
    const userItemId = message.id || crypto.randomUUID();
    await db.insert(items).values({
      id: userItemId,
      conversationId,
      type: "message",
      role: "user",
      content: userText,
      status: "completed",
      createdAt: new Date(),
    }).onConflictDoNothing();

    if (blobIds && blobIds.length > 0) {
      await db
        .update(blobs)
        .set({ itemId: userItemId })
        .where(and(inArray(blobs.id, blobIds), eq(blobs.organizationId, organizationId)));
    }

    if (conv[0]?.title === "New Chat") {
      let titleText = userText.trim();
      if (!titleText && blobIds && blobIds.length > 0) {
        titleText = "File attachment";
      }
      await db
        .update(conversations)
        .set({ title: titleText || "New Chat", updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    } else {
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    }
  }

  await syncStaleRepos(organizationId);

  const priorItems = await db
    .select({
      id: items.id,
      role: items.role,
      content: items.content,
      status: items.status,
    })
    .from(items)
    .where(and(eq(items.conversationId, conversationId), eq(items.type, "message")))
    .orderBy(asc(items.createdAt));

  const uiMessages = itemsToUIMessages(priorItems);

  let agentImages: Array<{ base64: string; mediaType: string; filename?: string }> | undefined;
  if (blobIds && blobIds.length > 0) {
    const storageConfig = await getStorageConfig(organizationId);
    if (storageConfig) {
      const blobRecords = await db
        .select({ id: blobs.id, key: blobs.key, contentType: blobs.contentType, filename: blobs.filename })
        .from(blobs)
        .where(and(inArray(blobs.id, blobIds), eq(blobs.organizationId, organizationId)));

      agentImages = [];
      for (const blob of blobRecords) {
        const { buffer } = await fetchFile(storageConfig, blob.key);
        agentImages.push({
          base64: buffer.toString("base64"),
          mediaType: blob.contentType,
          filename: blob.filename,
        });
      }
    }
  }

  if (agentImages && agentImages.length > 0) {
    const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
    const TEXT_MEDIA_TYPES = new Set([
      "application/json", "application/xml", "application/javascript",
      "application/typescript", "application/x-yaml", "application/x-sh", "image/svg+xml",
    ]);

    const lastMsg = uiMessages[uiMessages.length - 1];
    if (lastMsg && lastMsg.role === "user") {
      const imageParts: UIMessage["parts"] = [];
      for (const img of agentImages) {
        if (SUPPORTED_IMAGE_TYPES.has(img.mediaType)) {
          imageParts.push({
            type: "file",
            mediaType: img.mediaType,
            url: `data:${img.mediaType};base64,${img.base64}`,
          } as UIMessage["parts"][number]);
        } else if (img.mediaType === "application/pdf") {
          imageParts.push({
            type: "file",
            mediaType: img.mediaType,
            url: `data:${img.mediaType};base64,${img.base64}`,
          } as UIMessage["parts"][number]);
        } else if (img.mediaType.startsWith("text/") || TEXT_MEDIA_TYPES.has(img.mediaType)) {
          const text = Buffer.from(img.base64, "base64").toString("utf-8");
          imageParts.push({ type: "text", text: `[File: ${img.filename || "file"}]\n${text}` });
        } else {
          imageParts.push({ type: "text", text: `[Attached file: ${img.filename || "file"} (${img.mediaType})]` });
        }
      }
      lastMsg.parts = [...imageParts, ...lastMsg.parts];
    }
  }

  const modelMessages = await convertToModelMessages(uiMessages, { ignoreIncompleteToolCalls: true });

  const { model, tools, systemPrompt, promptCachingEnabled, provider } = await getAgentConfig(
    organizationId,
    memberId,
    request.signal,
  );

  if (promptCachingEnabled) {
    const providerKey = provider === "bedrock" ? "bedrock" : "anthropic";
    const providerValue = provider === "bedrock"
      ? { cachePoint: { type: "default" } }
      : { cacheControl: { type: "ephemeral" } };
    const cacheOpts = { [providerKey]: providerValue };
    const toolNames = Object.keys(tools);
    if (toolNames.length > 0) {
      tools[toolNames[toolNames.length - 1]].providerOptions = cacheOpts;
    }
    if (modelMessages.length >= 2) {
      modelMessages[modelMessages.length - 2].providerOptions = cacheOpts;
    }
  }

  const assistantItemId = crypto.randomUUID();
  await db.insert(items).values({
    id: assistantItemId,
    conversationId,
    type: "message",
    role: "assistant",
    content: { text: "", toolCalls: [], stats: null },
    status: "in_progress",
    createdAt: new Date(),
  }).onConflictDoNothing();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolUseCount = 0;
  const startTime = Date.now();

  const systemForStream = promptCachingEnabled
    ? {
        role: "system" as const,
        content: systemPrompt,
        providerOptions: {
          [provider === "bedrock" ? "bedrock" : "anthropic"]: provider === "bedrock"
            ? { cachePoint: { type: "default" } }
            : { cacheControl: { type: "ephemeral" } },
        },
      }
    : systemPrompt;

  const result = streamText({
    model,
    system: systemForStream,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(50),
    abortSignal: request.signal,
    onStepFinish: ({ usage, toolCalls }) => {
      if (usage) {
        totalInputTokens += usage.inputTokens || 0;
        totalOutputTokens += usage.outputTokens || 0;
      }
      if (toolCalls) {
        for (const tc of toolCalls) {
          if (tc.toolName !== "askUserQuestion") {
            toolUseCount++;
          }
        }
      }
    },
  });

  const response = result.toUIMessageStreamResponse({
    originalMessages: uiMessages,
    onFinish: async ({ responseMessage: assistantMessage }) => {
      try {
        const durationMs = Date.now() - startTime;
        const stats = {
          toolUses: toolUseCount,
          tokens: totalInputTokens + totalOutputTokens,
          durationMs,
        };

        const parts: Array<
          | { type: "text"; text: string }
          | { type: "tool-call"; toolName: string; toolCallId: string; input: unknown; output: string }
          | { type: "step-start" }
        > = [];
        for (const part of assistantMessage.parts) {
          if (part.type === "text") {
            parts.push({ type: "text", text: (part as { text: string }).text });
          } else if (part.type === "step-start") {
            parts.push({ type: "step-start" });
          } else if (part.type === "dynamic-tool" || (part.type as string).startsWith("tool-")) {
            const tp = part as { toolName?: string; toolCallId?: string; input?: unknown; output?: unknown; type: string };
            const name = tp.toolName || tp.type.replace("tool-", "");
            if (name === "askUserQuestion") continue;
            parts.push({
              type: "tool-call",
              toolName: name,
              toolCallId: tp.toolCallId || crypto.randomUUID(),
              input: tp.input,
              output: typeof tp.output === "string" ? tp.output : JSON.stringify(tp.output || ""),
            });
          }
        }

        const text = parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("");

        await db
          .update(items)
          .set({
            content: { parts, text, stats },
            status: "completed",
          })
          .where(eq(items.id, assistantItemId));

        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, conversationId));

        console.log(`[agent] Stream completed for conversation=${conversationId} tokens=${stats.tokens} tools=${stats.toolUses} duration=${stats.durationMs}ms`);
      } catch (cleanupError) {
        console.error(`[agent] Cleanup error for conversation=${conversationId}:`, cleanupError);
      }
    },
  });

  Promise.resolve(result.consumeStream()).catch((err) => {
    console.error(`[agent] Stream error for conversation=${conversationId}:`, err);
  });

  return response;
}
