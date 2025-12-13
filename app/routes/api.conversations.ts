import type { Route } from "./+types/api.conversations";
import { db } from "~/lib/db/index.server";
import { conversations, items } from "~/lib/db/schema";
import { eq, desc } from "drizzle-orm";

// GET /api/conversations - List all conversations
export async function loader({}: Route.LoaderArgs) {
  const allConversations = await db
    .select()
    .from(conversations)
    .orderBy(desc(conversations.updatedAt));

  const conversationsWithItems = await Promise.all(
    allConversations.map(async (conv) => {
      const convItems = await db
        .select()
        .from(items)
        .where(eq(items.conversationId, conv.id))
        .orderBy(items.createdAt);

      return {
        id: conv.id,
        title: conv.title,
        createdAt: conv.createdAt.getTime(),
        updatedAt: conv.updatedAt.getTime(),
        items: convItems.map((item) => ({
          id: item.id,
          type: item.type,
          role: item.role,
          content: item.content,
          toolCallId: item.toolCallId,
          status: item.status,
          createdAt: item.createdAt.getTime(),
        })),
      };
    })
  );

  return Response.json(conversationsWithItems);
}

// POST /api/conversations - Create a new conversation
// DELETE /api/conversations - Delete a conversation (with ?id=xxx)
// PATCH /api/conversations - Rename a conversation (with ?id=xxx)
export async function action({ request }: Route.ActionArgs) {
  if (request.method === "POST") {
    const body = await request.json();
    const id = body.id || crypto.randomUUID();
    const title = body.title || "New Chat";

    await db.insert(conversations).values({
      id,
      title,
    });

    const newConv = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));

    return Response.json({
      id: newConv[0].id,
      title: newConv[0].title,
      createdAt: newConv[0].createdAt.getTime(),
      updatedAt: newConv[0].updatedAt.getTime(),
      items: [],
    });
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return new Response("Missing conversation id", { status: 400 });
    }

    await db.delete(conversations).where(eq(conversations.id, id));
    return Response.json({ success: true });
  }

  if (request.method === "PATCH") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const body = await request.json();

    if (!id) {
      return new Response("Missing conversation id", { status: 400 });
    }

    await db
      .update(conversations)
      .set({ title: body.title, updatedAt: new Date() })
      .where(eq(conversations.id, id));

    return Response.json({ success: true });
  }

  return new Response("Method not allowed", { status: 405 });
}
