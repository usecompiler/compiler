import type { Route } from "./+types/api.agent.$conversationId.stop";
import { requireActiveAuth } from "~/lib/auth.server";
import { db } from "~/lib/db/index.server";
import { conversations } from "~/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requestStop } from "~/lib/resumable.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const user = await requireActiveAuth(request);
  if (!user.organization) {
    return new Response("Organization required", { status: 403 });
  }

  const conversationId = params.conversationId;
  if (!conversationId) {
    return new Response("Conversation ID required", { status: 400 });
  }

  const conv = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)))
    .limit(1);

  if (conv.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  await requestStop(conversationId);
  return new Response(null, { status: 204 });
}
