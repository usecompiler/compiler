import { db } from "~/lib/db/index.server";
import { auditLogs, users } from "~/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function logAuditEvent(
  organizationId: string,
  actorId: string,
  action: string,
  metadata?: Record<string, unknown>
) {
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    organizationId,
    actorId,
    action,
    metadata: metadata ?? null,
  });
}

export async function getAuditLogs(organizationId: string, limit = 100, offset = 0) {
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .innerJoin(users, eq(auditLogs.actorId, users.id))
    .where(eq(auditLogs.organizationId, organizationId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;

  return { entries: rows.slice(0, limit), hasMore };
}
