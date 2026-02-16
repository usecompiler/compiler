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

export function validateTimezone(tz: string): string {
  try {
    if (Intl.supportedValuesOf("timeZone").includes(tz)) {
      return tz;
    }
  } catch {
    return "UTC";
  }
  return "UTC";
}

export async function getOrganizationAnalytics(
  organizationId: string,
  organizationCreatedAt: Date,
  timezone: string = "UTC"
): Promise<AnalyticsSummary> {
  const tz = validateTimezone(timezone);

  const startDate = new Date(organizationCreatedAt);
  startDate.setDate(1);
  startDate.setHours(0, 0, 0, 0);

  const conversationStats = await db
    .select({
      date: sql<string>`DATE(${conversations.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::text`.as("date"),
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
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const messageStats = await db
    .select({
      date: sql<string>`DATE(${items.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::text`.as("date"),
      count: count(items.id),
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
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const dauStats = await db
    .select({
      date: sql<string>`DATE(${items.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::text`.as("date"),
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
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const tokenStats = await db
    .select({
      date: sql<string>`DATE(${items.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::text`.as("date"),
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
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const shareStats = await db
    .select({
      date: sql<string>`DATE(${conversationShares.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::text`.as("date"),
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
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const reviewRequestStats = await db
    .select({
      date: sql<string>`DATE(${reviewRequests.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::text`.as("date"),
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
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const wauCurrent = await db.execute(sql`
    SELECT COUNT(DISTINCT c.user_id)::integer as count
    FROM items i
    INNER JOIN conversations c ON i.conversation_id = c.id
    INNER JOIN members m ON c.user_id = m.user_id
    WHERE m.organization_id = ${organizationId}
      AND i.type = 'message'
      AND i.role = 'user'
      AND DATE(i.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) >= date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE ${tz})::date
  `);

  const mauCurrent = await db.execute(sql`
    SELECT COUNT(DISTINCT c.user_id)::integer as count
    FROM items i
    INNER JOIN conversations c ON i.conversation_id = c.id
    INNER JOIN members m ON c.user_id = m.user_id
    WHERE m.organization_id = ${organizationId}
      AND i.type = 'message'
      AND i.role = 'user'
      AND DATE(i.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE ${tz})::date
  `);

  const startDateISO = startDate.toISOString();

  const rollingWauStats = await db.execute(sql`
    WITH dates AS (
      SELECT generate_series(${startDateISO}::date, (CURRENT_TIMESTAMP AT TIME ZONE ${tz})::date, '1 day'::interval)::date AS date
    ),
    user_activity AS (
      SELECT DISTINCT
        DATE(i.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) as activity_date,
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
      SELECT generate_series(${startDateISO}::date, (CURRENT_TIMESTAMP AT TIME ZONE ${tz})::date, '1 day'::interval)::date AS date
    ),
    user_activity AS (
      SELECT DISTINCT
        DATE(i.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) as activity_date,
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
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  const endDateStr = formatter.format(new Date());
  let currentStr = formatter.format(startDate);

  while (currentStr <= endDateStr) {
    const dayMessages = messageMap.get(currentStr) || 0;
    const dayActiveUsers = dauMap.get(currentStr) || 0;
    stats.push({
      date: currentStr,
      conversationCount: conversationMap.get(currentStr) || 0,
      messageCount: dayMessages,
      activeUserCount: dayActiveUsers,
      wauCount: wauMap.get(currentStr) || 0,
      mauCount: mauMap.get(currentStr) || 0,
      avgMessagesPerUser: dayActiveUsers > 0 ? dayMessages / dayActiveUsers : 0,
      tokenCount: tokenMap.get(currentStr) || 0,
      shareCount: shareMap.get(currentStr) || 0,
      reviewRequestCount: reviewRequestMap.get(currentStr) || 0,
    });
    const [y, m, d] = currentStr.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    currentStr = next.toISOString().split("T")[0];
  }

  const today = stats.length > 0 ? stats[stats.length - 1] : null;

  const totals: AnalyticsTotals = {
    dau: today?.activeUserCount ?? 0,
    wau: (wauCurrent as unknown as { count: number }[])[0]?.count || 0,
    mau: (mauCurrent as unknown as { count: number }[])[0]?.count || 0,
    conversations: today?.conversationCount ?? 0,
    messages: today?.messageCount ?? 0,
    avgMessagesPerUser: today?.avgMessagesPerUser ?? 0,
    shares: today?.shareCount ?? 0,
    reviewRequests: today?.reviewRequestCount ?? 0,
    tokens: today?.tokenCount ?? 0,
  };

  return { stats, totals };
}
