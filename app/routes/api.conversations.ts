import type { Route } from "./+types/api.conversations";
import { db } from "~/lib/db/index.server";
import { conversations, items } from "~/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireActiveAuth } from "~/lib/auth.server";
import { getConversations, isUserInOrg } from "~/lib/conversations.server";

// GET /api/conversations - List conversations with pagination
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const url = new URL(request.url);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const impersonateUserId = url.searchParams.get("impersonate");

  let targetUserId = user.id;

  // Handle impersonation for org owners
  if (impersonateUserId && user.membership?.role === "owner" && user.organization) {
    const isInOrg = await isUserInOrg(impersonateUserId, user.organization.id);
    if (isInOrg) {
      targetUserId = impersonateUserId;
    }
  }

  const { conversations: convList, hasMore } = await getConversations(targetUserId, { limit, offset });
  return Response.json({ conversations: convList, hasMore });
}

// POST /api/conversations - Create a new conversation
// DELETE /api/conversations - Delete a conversation (with ?id=xxx)
// PATCH /api/conversations - Rename a conversation (with ?id=xxx)
export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

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
