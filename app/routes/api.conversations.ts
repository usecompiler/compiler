import type { Route } from "./+types/api.conversations";
import { db } from "~/lib/db/index.server";
import { conversations, items } from "~/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireActiveAuth } from "~/lib/auth.server";
import { NEW_CHAT_TITLE } from "~/lib/conversations.server";
import { sendNewConversationNotificationEmail, fireAndForget } from "~/lib/signup-emails.server";
import { getConversations, isUserInOrg } from "~/lib/conversations.server";
import { getMembers } from "~/lib/invitations.server";
import { canManageOrganization, canImpersonate } from "~/lib/permissions.server";
import { logAuditEvent } from "~/lib/audit.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const url = new URL(request.url);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const impersonateUserId = url.searchParams.get("impersonate");
  const projectId = url.searchParams.get("projectId") || undefined;

  let targetUserId = user.id;

  if (impersonateUserId && canManageOrganization(user.membership?.role) && user.organization) {
    const isInOrg = await isUserInOrg(impersonateUserId, user.organization.id);
    if (isInOrg) {
      const members = await getMembers(user.organization.id);
      const targetMember = members.find((m) => m.userId === impersonateUserId);
      if (targetMember && canImpersonate(user.membership?.role, targetMember.role)) {
        targetUserId = impersonateUserId;
      }
    }
  }

  const { conversations: convList, hasMore } = await getConversations(targetUserId, { limit, offset, projectId });
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
    const title = body.title || NEW_CHAT_TITLE;
    const projectId = body.projectId || null;

    const [newConv] = await db.insert(conversations).values({
      id,
      userId: user.id,
      title,
      projectId,
    }).returning();

    if (user.organization) {
      await logAuditEvent(user.organization.id, user.id, "created conversation", { conversationId: id });
    }
    fireAndForget(sendNewConversationNotificationEmail({ userName: user.name, userEmail: user.email }));

    return Response.json({
      id: newConv.id,
      title: newConv.title,
      createdAt: newConv.createdAt.getTime(),
      updatedAt: newConv.updatedAt.getTime(),
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

    if (user.organization) {
      await logAuditEvent(user.organization.id, user.id, "deleted conversation", { conversationId: id });
    }

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
      .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)));

    return Response.json({ success: true });
  }

  return new Response("Method not allowed", { status: 405 });
}
