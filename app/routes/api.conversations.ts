import type { Route } from "./+types/api.conversations";
import { db } from "~/lib/db/index.server";
import { conversations, items } from "~/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "~/lib/auth.server";

// GET /api/conversations - List all conversations for current user
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAuth(request);

  const allConversations = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, user.id))
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
  const user = await requireAuth(request);

  if (request.method === "POST") {
    const body = await request.json();
    const id = body.id || crypto.randomUUID();
    const title = body.title || "New Chat";

    await db.insert(conversations).values({
      id,
      userId: user.id,
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

    // Only delete if owned by user
    await db
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)));
    return Response.json({ success: true });
  }

  if (request.method === "PATCH") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const body = await request.json();

    if (!id) {
      return new Response("Missing conversation id", { status: 400 });
    }

    // Only update if owned by user
    await db
      .update(conversations)
      .set({ title: body.title, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)));

    return Response.json({ success: true });
  }

  return new Response("Method not allowed", { status: 405 });
}
