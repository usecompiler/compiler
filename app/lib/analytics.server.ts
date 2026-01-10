import { db } from "~/lib/db/index.server";
import { conversations, conversationShares, items, members, reviewRequests } from "~/lib/db/schema";
import { eq, and, gte, sql, count, countDistinct, isNull } from "drizzle-orm";

export interface DailyStats {
  date: string;
  conversationCount: number;
  messageCount: number;
  activeUserCount: number;
  wauCount: number;
  mauCount: number;
  avgMessagesPerUser: number;
  tokenCount: number;
  shareCount: number;
  reviewRequestCount: number;
}

export interface AnalyticsTotals {
  dau: number;
  wau: number;
  mau: number;
  conversations: number;
  messages: number;
  avgMessagesPerUser: number;
  shares: number;
  reviewRequests: number;
  tokens: number;
}

export interface AnalyticsSummary {
  stats: DailyStats[];
  totals: AnalyticsTotals;
}

export async function getOrganizationAnalytics(
  organizationId: string,
  organizationCreatedAt: Date,
  timezone: string = "UTC"
): Promise<AnalyticsSummary> {
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
      tokens: sql<number>`COALESCE(SUM((${items.content}->'stats'->'tokens')::bigint), 0)::bigint`,
    })
    .from(items)
    .innerJoin(conversations, eq(items.conversationId, conversations.id))
    .innerJoin(members, eq(conversations.userId, members.userId))
    .where(
      and(
        eq(members.organizationId, organizationId),
        eq(items.type, "message"),
        eq(items.role, "assistant"),
        gte(items.createdAt, startDate),
        sql`${items.content}->'stats'->'tokens' IS NOT NULL`,
        sql`jsonb_typeof(${items.content}->'stats'->'tokens') = 'number'`
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

  const reviewRequestStats = await db
    .select({
      date: sql<string>`DATE(${reviewRequests.createdAt})`.as("date"),
      count: count(reviewRequests.id),
    })
    .from(reviewRequests)
    .innerJoin(conversations, eq(reviewRequests.conversationId, conversations.id))
    .innerJoin(members, eq(conversations.userId, members.userId))
    .where(
      and(
        eq(members.organizationId, organizationId),
        gte(reviewRequests.createdAt, startDate)
      )
    )
    .groupBy(sql`DATE(${reviewRequests.createdAt})`)
    .orderBy(sql`DATE(${reviewRequests.createdAt})`);

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const wauCurrent = await db
    .select({ count: countDistinct(conversations.userId) })
    .from(items)
    .innerJoin(conversations, eq(items.conversationId, conversations.id))
    .innerJoin(members, eq(conversations.userId, members.userId))
    .where(
      and(
        eq(members.organizationId, organizationId),
        eq(items.type, "message"),
        eq(items.role, "user"),
        gte(items.createdAt, sevenDaysAgo)
      )
    );

  const mauCurrent = await db
    .select({ count: countDistinct(conversations.userId) })
    .from(items)
    .innerJoin(conversations, eq(items.conversationId, conversations.id))
    .innerJoin(members, eq(conversations.userId, members.userId))
    .where(
      and(
        eq(members.organizationId, organizationId),
        eq(items.type, "message"),
        eq(items.role, "user"),
        gte(items.createdAt, thirtyDaysAgo)
      )
    );

  const startDateISO = startDate.toISOString();

  const rollingWauStats = await db.execute(sql`
    WITH dates AS (
      SELECT generate_series(${startDateISO}::date, CURRENT_DATE, '1 day'::interval)::date AS date
    ),
    user_activity AS (
      SELECT DISTINCT
        DATE(i.created_at) as activity_date,
        c.user_id as user_id
      FROM items i
      INNER JOIN conversations c ON i.conversation_id = c.id
      INNER JOIN members m ON c.user_id = m.user_id
      WHERE m.organization_id = ${organizationId}
        AND i.type = 'message'
        AND i.role = 'user'
        AND i.created_at >= ${startDateISO}::timestamp
    )
    SELECT
      d.date::text as date,
      COUNT(DISTINCT ua.user_id)::integer as count
    FROM dates d
    LEFT JOIN user_activity ua ON ua.activity_date > d.date - INTERVAL '7 days' AND ua.activity_date <= d.date
    GROUP BY d.date
    ORDER BY d.date
  `);

  const rollingMauStats = await db.execute(sql`
    WITH dates AS (
      SELECT generate_series(${startDateISO}::date, CURRENT_DATE, '1 day'::interval)::date AS date
    ),
    user_activity AS (
      SELECT DISTINCT
        DATE(i.created_at) as activity_date,
        c.user_id as user_id
      FROM items i
      INNER JOIN conversations c ON i.conversation_id = c.id
      INNER JOIN members m ON c.user_id = m.user_id
      WHERE m.organization_id = ${organizationId}
        AND i.type = 'message'
        AND i.role = 'user'
        AND i.created_at >= ${startDateISO}::timestamp
    )
    SELECT
      d.date::text as date,
      COUNT(DISTINCT ua.user_id)::integer as count
    FROM dates d
    LEFT JOIN user_activity ua ON ua.activity_date > d.date - INTERVAL '30 days' AND ua.activity_date <= d.date
    GROUP BY d.date
    ORDER BY d.date
  `);

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
    const tokens = typeof row.tokens === 'string' ? parseInt(row.tokens, 10) : Number(row.tokens);
    if (Number.isFinite(tokens) && tokens >= 0 && tokens < 1e12) {
      tokenMap.set(row.date, tokens);
    }
  }

  const shareMap = new Map<string, number>();
  for (const row of shareStats) {
    shareMap.set(row.date, row.count);
  }

  const reviewRequestMap = new Map<string, number>();
  for (const row of reviewRequestStats) {
    reviewRequestMap.set(row.date, row.count);
  }

  const wauMap = new Map<string, number>();
  for (const row of rollingWauStats as unknown as { date: string; count: number }[]) {
    wauMap.set(row.date, row.count);
  }

  const mauMap = new Map<string, number>();
  for (const row of rollingMauStats as unknown as { date: string; count: number }[]) {
    mauMap.set(row.date, row.count);
  }

  const stats: DailyStats[] = [];
  const current = new Date(startDate);
  const nowInTimezone = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
  const today = new Date(nowInTimezone);
  today.setHours(23, 59, 59, 999);

  while (current <= today) {
    const dateStr = current.toISOString().split("T")[0];
    const dayMessages = messageMap.get(dateStr) || 0;
    const dayActiveUsers = dauMap.get(dateStr) || 0;
    stats.push({
      date: dateStr,
      conversationCount: conversationMap.get(dateStr) || 0,
      messageCount: dayMessages,
      activeUserCount: dayActiveUsers,
      wauCount: wauMap.get(dateStr) || 0,
      mauCount: mauMap.get(dateStr) || 0,
      avgMessagesPerUser: dayActiveUsers > 0 ? dayMessages / dayActiveUsers : 0,
      tokenCount: tokenMap.get(dateStr) || 0,
      shareCount: shareMap.get(dateStr) || 0,
      reviewRequestCount: reviewRequestMap.get(dateStr) || 0,
    });
    current.setDate(current.getDate() + 1);
  }

  const last30Days = stats.slice(-30);
  const lastDayDau = stats.length > 0 ? stats[stats.length - 1].activeUserCount : 0;
  const totalMessages = last30Days.reduce((sum, d) => sum + d.messageCount, 0);
  const mau = mauCurrent[0]?.count || 0;

  const totals: AnalyticsTotals = {
    dau: lastDayDau,
    wau: wauCurrent[0]?.count || 0,
    mau,
    conversations: last30Days.reduce((sum, d) => sum + d.conversationCount, 0),
    messages: totalMessages,
    avgMessagesPerUser: mau > 0 ? totalMessages / mau : 0,
    shares: last30Days.reduce((sum, d) => sum + d.shareCount, 0),
    reviewRequests: last30Days.reduce((sum, d) => sum + d.reviewRequestCount, 0),
    tokens: last30Days.reduce((sum, d) => sum + d.tokenCount, 0),
  };

  return { stats, totals };
}
