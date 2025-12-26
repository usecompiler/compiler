import type { Route } from "./+types/api.items";
import { db } from "~/lib/db/index.server";
import { conversations, items } from "~/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "~/lib/auth.server";
import { getConversationByShareToken, isUserInOrg, markReviewRequestAsReviewed } from "~/lib/conversations.server";

export async function action({ request }: Route.ActionArgs) {
  const user = await requireAuth(request);

  if (request.method === "POST") {
    const body = await request.json();
    const { conversationId, item, shareToken } = body;

    if (!conversationId || !item) {
      return new Response("Missing conversationId or item", { status: 400 });
    }

    let conv = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)));

    if (conv.length === 0 && item.type === "review" && shareToken) {
      const shareData = await getConversationByShareToken(shareToken);
      if (shareData && shareData.conversation.id === conversationId) {
        const userInOrg = await isUserInOrg(user.id, shareData.organizationId);
        if (userInOrg) {
          conv = await db
            .select()
            .from(conversations)
            .where(eq(conversations.id, conversationId));
        }
      }
    }

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

    if (item.type === "review") {
      await markReviewRequestAsReviewed(conversationId, user.id);
    }

    if (item.type === "message" && item.role === "user") {
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

    const itemResult = await db.select().from(items).where(eq(items.id, id));
    if (itemResult.length === 0) {
      return new Response("Item not found", { status: 404 });
    }

    const conv = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, itemResult[0].conversationId),
          eq(conversations.userId, user.id)
        )
      );

    if (conv.length === 0) {
      return new Response("Not authorized", { status: 403 });
    }

    const updates: Record<string, unknown> = {};
    if (body.content !== undefined) updates.content = body.content;
    if (body.status !== undefined) updates.status = body.status;

    await db.update(items).set(updates).where(eq(items.id, id));

    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, itemResult[0].conversationId));

    return Response.json({ success: true });
  }

  return new Response("Method not allowed", { status: 405 });
}
