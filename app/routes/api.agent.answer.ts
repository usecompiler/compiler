import type { Route } from "./+types/api.agent.answer";
import { requireActiveAuth } from "~/lib/auth.server";
import { submitAnswer } from "~/lib/agent.server";
import { db } from "~/lib/db/index.server";
import { conversations } from "~/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const user = await requireActiveAuth(request);
  if (!user.organization) {
    return new Response("Organization required", { status: 403 });
  }

  const body = await request.json();
  const { conversationId, answers } = body;

  if (!conversationId || !answers) {
    return new Response("Missing conversationId or answers", { status: 400 });
  }

  const conv = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, user.id),
      ),
    );

  if (conv.length === 0) {
    return new Response("Conversation not found", { status: 404 });
  }

  const resolved = submitAnswer(conversationId, answers);
  if (!resolved) {
    return new Response("No pending question", { status: 404 });
  }

  return Response.json({ success: true });
}
