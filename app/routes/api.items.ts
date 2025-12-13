import type { Route } from "./+types/api.items";
import { db } from "~/lib/db/index.server";
import { conversations, items } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

// POST /api/items - Add an item to a conversation
// PATCH /api/items - Update an item (with ?id=xxx)
export async function action({ request }: Route.ActionArgs) {
  if (request.method === "POST") {
    const body = await request.json();
    const { conversationId, item } = body;

    if (!conversationId || !item) {
      return new Response("Missing conversationId or item", { status: 400 });
    }

    // Insert the item
    await db.insert(items).values({
      id: item.id,
      conversationId,
      type: item.type,
      role: item.role || null,
      content: item.content || null,
      toolCallId: item.toolCallId || null,
      status: item.status || null,
    });

    // Update conversation title if it's the first user message
    if (item.type === "message" && item.role === "user") {
      const conv = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId));

      if (conv[0]?.title === "New Chat") {
        const text =
          typeof item.content === "string"
            ? item.content
            : item.content?.text || "";
        const newTitle = text.slice(0, 50).trim() + (text.length > 50 ? "..." : "");
        await db
          .update(conversations)
          .set({ title: newTitle, updatedAt: new Date() })
          .where(eq(conversations.id, conversationId));
      } else {
        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, conversationId));
      }
    } else {
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    }

    return Response.json({ success: true });
  }

  if (request.method === "PATCH") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const body = await request.json();

    if (!id) {
      return new Response("Missing item id", { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (body.content !== undefined) updates.content = body.content;
    if (body.status !== undefined) updates.status = body.status;

    await db.update(items).set(updates).where(eq(items.id, id));

    // Update parent conversation's updatedAt
    const item = await db.select().from(items).where(eq(items.id, id));
    if (item[0]) {
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, item[0].conversationId));
    }

    return Response.json({ success: true });
  }

  return new Response("Method not allowed", { status: 405 });
}
