import { randomBytes } from "crypto";
import { db } from "~/lib/db/index.server";
import { conversations as conversationsTable, items as itemsTable, members, conversationShares, users, reviewRequests } from "~/lib/db/schema";
import { eq, desc, and, isNull, or, ilike, sql } from "drizzle-orm";
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

export async function getConversation(conversationId: string): Promise<{ id: string; userId: string; title: string } | null> {
  const result = await db
    .select({
      id: conversationsTable.id,
      userId: conversationsTable.userId,
      title: conversationsTable.title,
    })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);

  return result[0] || null;
}

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

const CONVERSATIONS_PAGE_SIZE = 20;

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
    .limit(limit + 1)
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
  limit: number = 10
): Promise<SearchResult[]> {
  if (!query.trim()) {
    return [];
  }

  const searchPattern = `%${query.toLowerCase()}%`;

  const titleMatches = await db
    .select({
      id: conversationsTable.id,
      title: conversationsTable.title,
      updatedAt: conversationsTable.updatedAt,
    })
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.userId, userId),
        ilike(conversationsTable.title, searchPattern)
      )
    )
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(limit);

  const contentMatches = await db
    .select({
      conversationId: conversationsTable.id,
      title: conversationsTable.title,
      updatedAt: conversationsTable.updatedAt,
      content: itemsTable.content,
    })
    .from(itemsTable)
    .innerJoin(conversationsTable, eq(itemsTable.conversationId, conversationsTable.id))
    .where(
      and(
        eq(conversationsTable.userId, userId),
        eq(itemsTable.type, "message"),
        or(
          sql`LOWER(${itemsTable.content}::text) LIKE ${searchPattern}`,
          sql`LOWER(${itemsTable.content}->>'text') LIKE ${searchPattern}`
        )
      )
    )
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
        const start = Math.max(0, matchIndex - 30);
        const end = Math.min(contentText.length, matchIndex + query.length + 30);
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

export interface ReviewRequest {
  id: string;
  conversationId: string;
  conversationTitle: string;
  requestedByName: string;
  shareToken: string;
  createdAt: number;
}

export async function getReviewRequestsForUser(userId: string): Promise<ReviewRequest[]> {
  const result = await db
    .select({
      id: reviewRequests.id,
      conversationId: reviewRequests.conversationId,
      conversationTitle: conversationsTable.title,
      requestedByName: users.name,
      shareToken: reviewRequests.shareToken,
      createdAt: reviewRequests.createdAt,
    })
    .from(reviewRequests)
    .innerJoin(conversationsTable, eq(reviewRequests.conversationId, conversationsTable.id))
    .innerJoin(users, eq(reviewRequests.requestedByUserId, users.id))
    .where(
      and(
        eq(reviewRequests.requestedToUserId, userId),
        eq(reviewRequests.status, "pending")
      )
    )
    .orderBy(desc(reviewRequests.createdAt));

  return result.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    conversationTitle: row.conversationTitle,
    requestedByName: row.requestedByName,
    shareToken: row.shareToken,
    createdAt: row.createdAt.getTime(),
  }));
}

export async function createReviewRequest(
  conversationId: string,
  requestedByUserId: string,
  requestedToUserId: string,
  shareToken: string
): Promise<string> {
  const id = crypto.randomUUID();

  await db.insert(reviewRequests).values({
    id,
    conversationId,
    requestedByUserId,
    requestedToUserId,
    shareToken,
  });

  return id;
}

export async function markReviewRequestAsReviewed(
  conversationId: string,
  userId: string
): Promise<void> {
  await db
    .update(reviewRequests)
    .set({ status: "reviewed", reviewedAt: new Date() })
    .where(
      and(
        eq(reviewRequests.conversationId, conversationId),
        eq(reviewRequests.requestedToUserId, userId),
        eq(reviewRequests.status, "pending")
      )
    );
}

export async function dismissReviewRequest(
  reviewRequestId: string,
  userId: string
): Promise<void> {
  await db
    .update(reviewRequests)
    .set({ status: "dismissed" })
    .where(
      and(
        eq(reviewRequests.id, reviewRequestId),
        eq(reviewRequests.requestedToUserId, userId),
        eq(reviewRequests.status, "pending")
      )
    );
}

export async function hasPendingReviewRequest(
  conversationId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .select({ id: reviewRequests.id })
    .from(reviewRequests)
    .where(
      and(
        eq(reviewRequests.conversationId, conversationId),
        eq(reviewRequests.requestedToUserId, userId),
        eq(reviewRequests.status, "pending")
      )
    )
    .limit(1);

  return result.length > 0;
}
