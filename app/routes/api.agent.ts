import type { Route } from "./+types/api.agent";
import { runAgent } from "~/lib/agent.server";
import { requireActiveAuth } from "~/lib/auth.server";
import { syncStaleRepos } from "~/lib/clone.server";
import { db } from "~/lib/db/index.server";
import { conversations, items } from "~/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const user = await requireActiveAuth(request);
  if (!user.organization) {
    return new Response("Organization required", { status: 403 });
  }

  const body = await request.json();
  const prompt = body.prompt;
  const conversationId: string | undefined = body.conversationId;
  const userItem: {
    id: string;
    type: string;
    role?: string;
    content?: unknown;
    status?: string;
    createdAt: number;
  } | undefined = body.userItem;
  const assistantItemId: string | undefined = body.assistantItemId;

  if (!prompt || typeof prompt !== "string") {
    return new Response("Missing prompt", { status: 400 });
  }

  if (!conversationId || !userItem || !assistantItemId) {
    return new Response("Missing conversationId, userItem, or assistantItemId", { status: 400 });
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
      sessionId: conversations.sessionId,
    })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)));

  if (conv.length === 0) {
    return new Response("Conversation not found", { status: 404 });
  }

  await db.insert(items).values({
    id: userItem.id,
    conversationId,
    type: userItem.type,
    role: userItem.role || null,
    content: userItem.content || null,
    status: userItem.status || null,
    createdAt: userItem.createdAt ? new Date(userItem.createdAt) : new Date(),
  });

  await db.insert(items).values({
    id: assistantItemId,
    conversationId,
    type: "message",
    role: "assistant",
    content: { text: "", toolCalls: [], stats: null },
    status: "in_progress",
    createdAt: new Date(userItem.createdAt + 1),
  });

  if (conv[0]?.title === "New Chat") {
    const titleText =
      typeof userItem.content === "string"
        ? userItem.content
        : (userItem.content as { text?: string })?.text || "";
    await db
      .update(conversations)
      .set({ title: titleText.trim(), updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  } else {
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }

  await syncStaleRepos(organizationId);

  let effectivePrompt = prompt;
  if (!conv[0].sessionId) {
    const priorItems = await db
      .select({
        role: items.role,
        content: items.content,
      })
      .from(items)
      .where(and(eq(items.conversationId, conversationId), eq(items.type, "message")))
      .orderBy(asc(items.createdAt));

    if (priorItems.length > 0) {
      const historyLines = priorItems
        .filter((item) => item.role === "user" || item.role === "assistant")
        .map((item) => {
          const text =
            typeof item.content === "string"
              ? item.content
              : (item.content as { text?: string })?.text || "";
          return `${item.role === "user" ? "User" : "Assistant"}: ${text}`;
        });
      if (historyLines.length > 0) {
        effectivePrompt = historyLines.join("\n\n") + "\n\nUser: " + prompt;
      }
    }
  }

  let currentText = "";
  let currentToolCalls: Array<{ id: string; tool: string; input: unknown; result?: string }> = [];
  let toolsStartIndex: number | null = null;
  let finalStats: { toolUses: number; tokens: number; durationMs: number } | null = null;
  let streamCompleted = false;
  let activeItemId = assistantItemId;
  let awaitingQuestionResult = false;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        for await (const event of runAgent(effectivePrompt, organizationId, memberId, conversationId, conv[0].sessionId, request.signal)) {
          if (event.type === "session_init" && event.sessionId) {
            await db
              .update(conversations)
              .set({ sessionId: event.sessionId })
              .where(eq(conversations.id, conversationId));
          }

          if (event.type === "new_turn") {
            if (awaitingQuestionResult) {
              awaitingQuestionResult = false;
              await db
                .update(items)
                .set({
                  content: { text: currentText, toolCalls: currentToolCalls, toolsStartIndex, stats: null },
                  status: "completed",
                })
                .where(eq(items.id, activeItemId));

              currentText = "";
              currentToolCalls = [];
              toolsStartIndex = null;
              activeItemId = crypto.randomUUID();
              await db.insert(items).values({
                id: activeItemId,
                conversationId,
                type: "message",
                role: "assistant",
                content: { text: "", toolCalls: [], stats: null },
                status: "in_progress",
                createdAt: new Date(),
              });
            } else {
              currentText += "\n\n";
            }
          } else if (event.type === "text") {
            currentText += event.content;
          } else if (event.type === "tool_use") {
            if (event.tool === "AskUserQuestion") {
              awaitingQuestionResult = true;
            } else {
              if (toolsStartIndex === null) {
                toolsStartIndex = currentText.length;
              }
              currentToolCalls = [...currentToolCalls, {
                id: crypto.randomUUID(),
                tool: event.tool!,
                input: event.input,
              }];
            }
          } else if (event.type === "tool_result") {
            if (awaitingQuestionResult) {
              continue;
            }
            if (currentToolCalls.length > 0) {
              const updatedCalls = [...currentToolCalls];
              updatedCalls[updatedCalls.length - 1].result = event.content;
              currentToolCalls = updatedCalls;
            }
          } else if (event.type === "result" && event.stats) {
            finalStats = event.stats;
            streamCompleted = true;
          }

          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
      } catch (error) {
        const errorEvent = {
          type: "error",
          content: error instanceof Error ? error.message : "Stream error",
        };
        currentText += `\n\nError: ${errorEvent.content}`;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`)
        );
      } finally {
        try {
          if (streamCompleted && finalStats) {
            await db
              .update(items)
              .set({
                content: { text: currentText, toolCalls: currentToolCalls, toolsStartIndex, stats: finalStats },
                status: "completed",
              })
              .where(eq(items.id, activeItemId));
          } else {
            await db
              .update(items)
              .set({
                content: { text: currentText, toolCalls: currentToolCalls, toolsStartIndex, stats: null },
                status: "cancelled",
              })
              .where(eq(items.id, activeItemId));
          }

          await db
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, conversationId));
        } catch (_) {
        }

        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
