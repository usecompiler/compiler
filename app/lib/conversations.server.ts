import { db } from "~/lib/db/index.server";
import { conversations as conversationsTable, items as itemsTable } from "~/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import type { Conversation, Item, ItemType } from "~/lib/types";

export type { Conversation, Item, ItemType };

export async function getConversationsWithItems(userId: string): Promise<Conversation[]> {
  const dbConversations = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.userId, userId))
    .orderBy(desc(conversationsTable.updatedAt));

  const conversationsWithItems: Conversation[] = await Promise.all(
    dbConversations.map(async (conv) => {
      const dbItems = await db
        .select()
        .from(itemsTable)
        .where(eq(itemsTable.conversationId, conv.id));

      return {
        id: conv.id,
        title: conv.title,
        items: dbItems.map((item) => ({
          id: item.id,
          type: item.type as ItemType,
          role: item.role as "user" | "assistant" | undefined,
          content: item.content,
          toolCallId: item.toolCallId ?? undefined,
          status: item.status as "in_progress" | "completed" | "cancelled" | undefined,
          createdAt: item.createdAt.getTime(),
        })),
        createdAt: conv.createdAt.getTime(),
        updatedAt: conv.updatedAt.getTime(),
      };
    })
  );

  return conversationsWithItems;
}
