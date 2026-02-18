import type { Route } from "./+types/api.items";
import { db } from "~/lib/db/index.server";
import { conversations, items } from "~/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "~/lib/auth.server";

export async function action({ request }: Route.ActionArgs) {
  const user = await requireAuth(request);

  if (request.method === "POST") {
    const body = await request.json();
    const { conversationId, item } = body;

    if (!conversationId || !item) {
      return new Response("Missing conversationId or item", { status: 400 });
    }

    const conv = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)));

    if (conv.length === 0) {
      return new Response("Conversation not found", { status: 404 });
    }

    await db.insert(items).values({
      id: item.id,
      conversationId,
      type: item.type,
      role: item.role || null,
      content: item.content || null,
      toolCallId: item.toolCallId || null,
      status: item.status || null,
      createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
    });

    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    return Response.json({ success: true });
  }

  return new Response("Method not allowed", { status: 405 });
}
