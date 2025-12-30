import { db } from "~/lib/db/index.server";
import { conversations, conversationShares, items, members } from "~/lib/db/schema";
import { eq, and, gte, sql, count, countDistinct, isNull } from "drizzle-orm";

export interface DailyStats {
  date: string;
  conversationCount: number;
  messageCount: number;
  activeUserCount: number;
  tokenCount: number;
  shareCount: number;
}

export async function getOrganizationAnalytics(
  organizationId: string,
  organizationCreatedAt: Date,
  timezone: string = "UTC"
): Promise<DailyStats[]> {
  const startDate = new Date(organizationCreatedAt);
  startDate.setDate(1);
  startDate.setHours(0, 0, 0, 0);

  const conversationStats = await db
    .select({
      date: sql<string>`DATE(${conversations.createdAt})`.as("date"),
      count: count(conversations.id),
    })
    .from(conversations)
    .innerJoin(members, eq(conversations.userId, members.userId))
    .where(
      and(
        eq(members.organizationId, organizationId),
        gte(conversations.createdAt, startDate)
      )
    )
    .groupBy(sql`DATE(${conversations.createdAt})`)
    .orderBy(sql`DATE(${conversations.createdAt})`);

  const messageStats = await db
    .select({
      date: sql<string>`DATE(${items.createdAt})`.as("date"),
      count: count(items.id),
    })
    .from(items)
    .innerJoin(conversations, eq(items.conversationId, conversations.id))
    .innerJoin(members, eq(conversations.userId, members.userId))
    .where(
      and(
        eq(members.organizationId, organizationId),
        eq(items.type, "message"),
        gte(items.createdAt, startDate)
      )
    )
    .groupBy(sql`DATE(${items.createdAt})`)
    .orderBy(sql`DATE(${items.createdAt})`);

  const dauStats = await db
    .select({
      date: sql<string>`DATE(${items.createdAt})`.as("date"),
      count: countDistinct(conversations.userId),
    })
    .from(items)
    .innerJoin(conversations, eq(items.conversationId, conversations.id))
    .innerJoin(members, eq(conversations.userId, members.userId))
    .where(
      and(
        eq(members.organizationId, organizationId),
        eq(items.type, "message"),
        eq(items.role, "user"),
        gte(items.createdAt, startDate)
      )
    )
    .groupBy(sql`DATE(${items.createdAt})`)
    .orderBy(sql`DATE(${items.createdAt})`);

  const tokenStats = await db
    .select({
      date: sql<string>`DATE(${items.createdAt})`.as("date"),
      tokens: sql<number>`COALESCE(SUM((${items.content}->'stats'->>'tokens')::integer), 0)`,
    })
    .from(items)
    .innerJoin(conversations, eq(items.conversationId, conversations.id))
    .innerJoin(members, eq(conversations.userId, members.userId))
    .where(
      and(
        eq(members.organizationId, organizationId),
        gte(items.createdAt, startDate),
        sql`${items.content}->'stats'->>'tokens' IS NOT NULL`
      )
    )
    .groupBy(sql`DATE(${items.createdAt})`)
    .orderBy(sql`DATE(${items.createdAt})`);

  const shareStats = await db
    .select({
      date: sql<string>`DATE(${conversationShares.createdAt})`.as("date"),
      count: count(conversationShares.id),
    })
    .from(conversationShares)
    .innerJoin(conversations, eq(conversationShares.conversationId, conversations.id))
    .innerJoin(members, eq(conversations.userId, members.userId))
    .where(
      and(
        eq(members.organizationId, organizationId),
        gte(conversationShares.createdAt, startDate),
        isNull(conversationShares.revokedAt)
      )
    )
    .groupBy(sql`DATE(${conversationShares.createdAt})`)
    .orderBy(sql`DATE(${conversationShares.createdAt})`);

  const conversationMap = new Map<string, number>();
  for (const row of conversationStats) {
    conversationMap.set(row.date, row.count);
  }

  const messageMap = new Map<string, number>();
  for (const row of messageStats) {
    messageMap.set(row.date, row.count);
  }

  const dauMap = new Map<string, number>();
  for (const row of dauStats) {
    dauMap.set(row.date, row.count);
  }

  const tokenMap = new Map<string, number>();
  for (const row of tokenStats) {
    tokenMap.set(row.date, row.tokens);
  }

  const shareMap = new Map<string, number>();
  for (const row of shareStats) {
    shareMap.set(row.date, row.count);
  }

  const result: DailyStats[] = [];
  const current = new Date(startDate);
  const nowInTimezone = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
  const today = new Date(nowInTimezone);
  today.setHours(23, 59, 59, 999);

  while (current <= today) {
    const dateStr = current.toISOString().split("T")[0];
    result.push({
      date: dateStr,
      conversationCount: conversationMap.get(dateStr) || 0,
      messageCount: messageMap.get(dateStr) || 0,
      activeUserCount: dauMap.get(dateStr) || 0,
      tokenCount: tokenMap.get(dateStr) || 0,
      shareCount: shareMap.get(dateStr) || 0,
    });
    current.setDate(current.getDate() + 1);
  }

  return result;
}
