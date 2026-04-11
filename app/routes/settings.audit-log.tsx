import { useState, useEffect } from "react";
import { Link, redirect, useLoaderData, useFetcher } from "react-router";

import type { Route } from "./+types/settings.audit-log";
import { requireActiveAuth } from "~/lib/auth.server";
import { canManageOrganization } from "~/lib/permissions.server";
import { getAuditLogs } from "~/lib/audit.server";
import { db } from "~/lib/db/index.server";
import { conversations } from "~/lib/db/schema";
import { inArray } from "drizzle-orm";

const PAGE_SIZE = 50;

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!canManageOrganization(user.membership?.role)) {
    throw redirect("/settings");
  }

  if (!user.organization) {
    return { entries: [], conversationOwners: {} as Record<string, string>, hasMore: false, offset: 0 };
  }

  const url = new URL(request.url);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);

  const { entries, hasMore } = await getAuditLogs(user.organization.id, PAGE_SIZE, offset);

  const conversationIds = entries
    .map((e) => (e.metadata as Record<string, unknown> | null)?.conversationId)
    .filter((id): id is string => typeof id === "string");

  let conversationOwners: Record<string, string> = {};
  if (conversationIds.length > 0) {
    const existing = await db
      .select({ id: conversations.id, userId: conversations.userId })
      .from(conversations)
      .where(inArray(conversations.id, conversationIds));
    conversationOwners = Object.fromEntries(existing.map((r) => [r.id, r.userId]));
  }

  return { entries, conversationOwners, hasMore, offset };
}

function formatTimestamp(date: string | Date) {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AuditLogSettings() {
  const loaderData = useLoaderData<typeof loader>();
  const [entries, setEntries] = useState(loaderData.entries);
  const [hasMore, setHasMore] = useState(loaderData.hasMore);
  const [convOwners, setConvOwners] = useState(loaderData.conversationOwners);
  const fetcher = useFetcher<typeof loader>();

  useEffect(() => {
    setEntries(loaderData.entries);
    setHasMore(loaderData.hasMore);
    setConvOwners(loaderData.conversationOwners);
  }, [loaderData.entries, loaderData.hasMore, loaderData.conversationOwners]);

  useEffect(() => {
    if (fetcher.data) {
      setEntries((prev) => [...prev, ...fetcher.data!.entries]);
      setConvOwners((prev) => ({ ...prev, ...fetcher.data!.conversationOwners }));
      setHasMore(fetcher.data.hasMore);
    }
  }, [fetcher.data]);

  return (
      <main className="max-w-3xl mx-auto px-4 py-8">
        <section>
          <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
            Audit Log
          </h2>

          {entries.length === 0 ? (
            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6 text-center">
              <p className="text-neutral-500 dark:text-neutral-400">No audit log entries yet</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg divide-y divide-neutral-200 dark:divide-neutral-700">
              {entries.map((entry) => (
                <div key={entry.id} className="px-4 py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm text-neutral-900 dark:text-neutral-100">
                      <span className="font-medium">{entry.actorName}</span>{" "}
                      {entry.metadata && "conversationId" in entry.metadata && convOwners[entry.metadata.conversationId as string] ? (
                        <>
                          {entry.action}
                          {" · "}
                          <Link
                            to={`/c/${entry.metadata.conversationId}?impersonate=${convOwners[entry.metadata.conversationId as string]}`}
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            view
                          </Link>
                        </>
                      ) : (
                        entry.action
                      )}
                    </div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">
                      {entry.actorEmail}
                    </div>
                  </div>
                  <div className="text-xs text-neutral-400 dark:text-neutral-500 whitespace-nowrap flex-shrink-0">
                    {formatTimestamp(entry.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {hasMore && (
            <div className="mt-4 text-center">
              <button
                onClick={() => fetcher.load(`/settings/audit-log?offset=${entries.length}`)}
                disabled={fetcher.state !== "idle"}
                className="px-4 py-2 text-sm text-neutral-600 dark:text-neutral-300 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-750 disabled:opacity-50"
              >
                {fetcher.state !== "idle" ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </section>
      </main>
  );
}
