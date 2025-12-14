import { db } from "~/lib/db/index.server";
import { conversations as conversationsTable, items as itemsTable } from "~/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import type { Item, ItemType } from "~/lib/types";

export type { Item, ItemType };

// Sidebar conversation metadata (no items)
export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

const CONVERSATIONS_PAGE_SIZE = 20;

// Get conversations list for sidebar with pagination
export async function getConversations(
  userId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ conversations: ConversationMeta[]; hasMore: boolean }> {
  const limit = options?.limit ?? CONVERSATIONS_PAGE_SIZE;
  const offset = options?.offset ?? 0;

  const rows = await db
    .select({
      id: conversationsTable.id,
      title: conversationsTable.title,
      createdAt: conversationsTable.createdAt,
      updatedAt: conversationsTable.updatedAt,
    })
    .from(conversationsTable)
    .where(eq(conversationsTable.userId, userId))
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(limit + 1) // Fetch one extra to check hasMore
    .offset(offset);

  const hasMore = rows.length > limit;
  const conversations = rows.slice(0, limit).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }));

  return { conversations, hasMore };
}

// Get items for a specific conversation
export async function getConversationItems(conversationId: string): Promise<Item[]> {
  const rows = await db
    .select()
    .from(itemsTable)
    .where(eq(itemsTable.conversationId, conversationId))
    .orderBy(itemsTable.createdAt);

  return rows.map((item) => ({
    id: item.id,
    type: item.type as ItemType,
    role: item.role as "user" | "assistant" | undefined,
    content: item.content,
    toolCallId: item.toolCallId ?? undefined,
    status: item.status as "in_progress" | "completed" | "cancelled" | undefined,
    createdAt: item.createdAt.getTime(),
  }));
}
