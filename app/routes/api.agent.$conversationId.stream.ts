import type { Route } from "./+types/api.agent.$conversationId.stream";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { requireActiveAuth } from "~/lib/auth.server";
import { db } from "~/lib/db/index.server";
import { conversations } from "~/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getActiveStream, getStreamContext } from "~/lib/resumable.server";

export async function loader({ request, params }: Route.LoaderArgs) {
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
    return new Response(null, { status: 204 });
  }

  const activeStreamId = await getActiveStream(conversationId);
  if (!activeStreamId) {
    return new Response(null, { status: 204 });
  }

  const stream = await getStreamContext().resumeExistingStream(activeStreamId);
  if (!stream) {
    return new Response(null, { status: 204 });
  }

  return new Response(stream, { headers: UI_MESSAGE_STREAM_HEADERS });
}
