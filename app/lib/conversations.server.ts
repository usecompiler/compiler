import { randomBytes } from "crypto";
import { db } from "~/lib/db/index.server";
import { conversations as conversationsTable, items as itemsTable, members, conversationShares, users, blobs as blobsTable, itemBlobs as itemBlobsTable } from "~/lib/db/schema";
import { eq, desc, and, isNull, or, ilike, inArray, sql, asc } from "drizzle-orm";
import type { Item, ItemType } from "~/lib/types";

export type { Item, ItemType };

export async function isUserInOrg(userId: string, organizationId: string): Promise<boolean> {
  const result = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.userId, userId), eq(members.organizationId, organizationId)))
    .limit(1);

  return result.length > 0;
}

export async function getConversation(conversationId: string): Promise<{ id: string; userId: string; title: string; conversationId: string | null } | null> {
  const result = await db
    .select({
      id: conversationsTable.id,
      userId: conversationsTable.userId,
      title: conversationsTable.title,
      conversationId: conversationsTable.conversationId,
    })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);

  return result[0] || null;
}

export interface ConversationMeta {
  id: string;
  title: string;
  isForked: boolean;
  createdAt: number;
  updatedAt: number;
}

const CONVERSATIONS_PAGE_SIZE = 20;

export async function getConversations(
  userId: string,
  options?: { limit?: number; offset?: number; projectId?: string }
): Promise<{ conversations: ConversationMeta[]; hasMore: boolean }> {
  const limit = options?.limit ?? CONVERSATIONS_PAGE_SIZE;
  const offset = options?.offset ?? 0;

  const conditions = [eq(conversationsTable.userId, userId)];
  if (options?.projectId) {
    conditions.push(eq(conversationsTable.projectId, options.projectId));
  }

  const rows = await db
    .select({
      id: conversationsTable.id,
      title: conversationsTable.title,
      conversationId: conversationsTable.conversationId,
      createdAt: conversationsTable.createdAt,
      updatedAt: conversationsTable.updatedAt,
    })
    .from(conversationsTable)
    .where(and(...conditions))
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const conversations = rows.slice(0, limit).map((row) => ({
    id: row.id,
    title: row.title,
    isForked: !!row.conversationId,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }));

  return { conversations, hasMore };
}

export interface SearchResult {
  id: string;
  title: string;
  matchType: "title" | "content";
  snippet?: string;
  updatedAt: number;
}

export async function searchConversations(
  userId: string,
  query: string,
  limit: number = 10,
  projectId?: string
): Promise<SearchResult[]> {
  if (!query.trim()) {
    return [];
  }

  const searchPattern = `%${query.toLowerCase()}%`;

  const titleConditions = [
    eq(conversationsTable.userId, userId),
    ilike(conversationsTable.title, searchPattern),
  ];
  if (projectId) {
    titleConditions.push(eq(conversationsTable.projectId, projectId));
  }

  const titleMatches = await db
    .select({
      id: conversationsTable.id,
      title: conversationsTable.title,
      updatedAt: conversationsTable.updatedAt,
    })
    .from(conversationsTable)
    .where(and(...titleConditions))
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(limit);

  const contentConditions = [
    eq(conversationsTable.userId, userId),
    eq(itemsTable.type, "message"),
    or(
      sql`LOWER(${itemsTable.content}::text) LIKE ${searchPattern}`,
      sql`LOWER(${itemsTable.content}->>'text') LIKE ${searchPattern}`
    ),
  ];
  if (projectId) {
    contentConditions.push(eq(conversationsTable.projectId, projectId));
  }

  const contentMatches = await db
    .select({
      conversationId: conversationsTable.id,
      title: conversationsTable.title,
      updatedAt: conversationsTable.updatedAt,
      content: itemsTable.content,
    })
    .from(itemsTable)
    .innerJoin(conversationsTable, eq(itemsTable.conversationId, conversationsTable.id))
    .where(and(...contentConditions))
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(limit * 2);

  const results: SearchResult[] = [];
  const seenIds = new Set<string>();

  for (const match of titleMatches) {
    if (!seenIds.has(match.id)) {
      seenIds.add(match.id);
      results.push({
        id: match.id,
        title: match.title,
        matchType: "title",
        updatedAt: match.updatedAt.getTime(),
      });
    }
  }

  for (const match of contentMatches) {
    if (!seenIds.has(match.conversationId)) {
      seenIds.add(match.conversationId);
      const contentText = typeof match.content === "string"
        ? match.content
        : (match.content as { text?: string })?.text || "";

      const lowerContent = contentText.toLowerCase();
      const lowerQuery = query.toLowerCase();
      const matchIndex = lowerContent.indexOf(lowerQuery);

      let snippet = "";
      if (matchIndex !== -1) {
        const start = Math.max(0, matchIndex - 50);
        const end = Math.min(contentText.length, matchIndex + query.length + 50);
        snippet = (start > 0 ? "..." : "") + contentText.slice(start, end) + (end < contentText.length ? "..." : "");
      }

      results.push({
        id: match.conversationId,
        title: match.title,
        matchType: "content",
        snippet,
        updatedAt: match.updatedAt.getTime(),
      });
    }
  }

  results.sort((a, b) => b.updatedAt - a.updatedAt);

  return results.slice(0, limit);
}

export async function getConversationProjectId(conversationId: string): Promise<string | null> {
  const result = await db
    .select({ projectId: conversationsTable.projectId })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);

  return result[0]?.projectId ?? null;
}

export async function getMostRecentProjectId(userId: string): Promise<string | null> {
  const result = await db
    .select({ projectId: conversationsTable.projectId })
    .from(conversationsTable)
    .where(eq(conversationsTable.userId, userId))
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(1);

  return result[0]?.projectId ?? null;
}

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

export async function getConversationBlobs(
  conversationId: string
): Promise<Record<string, Array<{ id: string; contentType: string; filename: string }>>> {
  const conversationItems = await db
    .select({ id: itemsTable.id })
    .from(itemsTable)
    .where(eq(itemsTable.conversationId, conversationId));

  const itemIds = conversationItems.map((i) => i.id);
  if (itemIds.length === 0) return {};

  const rows = await db
    .select({
      id: blobsTable.id,
      contentType: blobsTable.contentType,
      filename: blobsTable.filename,
      itemId: itemBlobsTable.itemId,
    })
    .from(itemBlobsTable)
    .innerJoin(blobsTable, eq(itemBlobsTable.blobId, blobsTable.id))
    .where(inArray(itemBlobsTable.itemId, itemIds));

  const result: Record<string, Array<{ id: string; contentType: string; filename: string }>> = {};
  for (const row of rows) {
    if (!result[row.itemId]) result[row.itemId] = [];
    result[row.itemId].push({ id: row.id, contentType: row.contentType, filename: row.filename });
  }
  return result;
}

export interface ShareLink {
  token: string;
  createdAt: Date;
}

function generateShareToken(): string {
  return randomBytes(16).toString("hex");
}

export async function createShareLink(conversationId: string): Promise<string> {
  const existing = await getShareLink(conversationId);
  if (existing) {
    return existing.token;
  }

  const token = generateShareToken();
  const id = crypto.randomUUID();

  await db.insert(conversationShares).values({
    id,
    conversationId,
    token,
  });

  return token;
}

export async function getShareLink(conversationId: string): Promise<ShareLink | null> {
  const result = await db
    .select({
      token: conversationShares.token,
      createdAt: conversationShares.createdAt,
    })
    .from(conversationShares)
    .where(
      and(
        eq(conversationShares.conversationId, conversationId),
        isNull(conversationShares.revokedAt)
      )
    )
    .limit(1);

  return result[0] || null;
}

export async function revokeShareLink(conversationId: string): Promise<void> {
  await db
    .update(conversationShares)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(conversationShares.conversationId, conversationId),
        isNull(conversationShares.revokedAt)
      )
    );
}

export async function getConversationByShareToken(
  token: string
): Promise<{ conversation: { id: string; userId: string; title: string }; organizationId: string; ownerName: string } | null> {
  const result = await db
    .select({
      conversationId: conversationShares.conversationId,
      conversationTitle: conversationsTable.title,
      conversationUserId: conversationsTable.userId,
      organizationId: members.organizationId,
      ownerName: users.name,
    })
    .from(conversationShares)
    .innerJoin(conversationsTable, eq(conversationShares.conversationId, conversationsTable.id))
    .innerJoin(members, eq(conversationsTable.userId, members.userId))
    .innerJoin(users, eq(conversationsTable.userId, users.id))
    .where(
      and(
        eq(conversationShares.token, token),
        isNull(conversationShares.revokedAt)
      )
    )
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const row = result[0];
  return {
    conversation: {
      id: row.conversationId,
      userId: row.conversationUserId,
      title: row.conversationTitle,
    },
    organizationId: row.organizationId,
    ownerName: row.ownerName,
  };
}

export async function duplicateConversation(
  sourceConversationId: string,
  userId: string
): Promise<string> {
  const source = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, sourceConversationId))
    .limit(1);

  if (source.length === 0) {
    throw new Error("Source conversation not found");
  }

  const sourceConv = source[0];

  const sourceItems = await db
    .select()
    .from(itemsTable)
    .where(eq(itemsTable.conversationId, sourceConversationId))
    .orderBy(asc(itemsTable.createdAt));

  const newConversationId = crypto.randomUUID();

  await db.insert(conversationsTable).values({
    id: newConversationId,
    userId,
    title: sourceConv.title,
    conversationId: sourceConversationId,
    projectId: sourceConv.projectId,
  });

  const oldToNewItemId = new Map<string, string>();

  for (const item of sourceItems) {
    const newItemId = crypto.randomUUID();
    oldToNewItemId.set(item.id, newItemId);
  }

  for (const item of sourceItems) {
    const newItemId = oldToNewItemId.get(item.id)!;
    const remappedToolCallId = item.toolCallId
      ? oldToNewItemId.get(item.toolCallId) ?? item.toolCallId
      : null;

    await db.insert(itemsTable).values({
      id: newItemId,
      conversationId: newConversationId,
      type: item.type,
      role: item.role,
      content: item.content,
      toolCallId: remappedToolCallId,
      status: item.status,
      createdAt: item.createdAt,
    });
  }

  const sourceItemIds = sourceItems.map((i) => i.id);
  if (sourceItemIds.length > 0) {
    const blobLinks = await db
      .select()
      .from(itemBlobsTable)
      .where(inArray(itemBlobsTable.itemId, sourceItemIds));

    if (blobLinks.length > 0) {
      await db.insert(itemBlobsTable).values(
        blobLinks.map((link) => ({
          id: crypto.randomUUID(),
          itemId: oldToNewItemId.get(link.itemId)!,
          blobId: link.blobId,
        }))
      );
    }
  }

  return newConversationId;
}

