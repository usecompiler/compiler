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
    return { entries: [], existingConversationIds: [] as string[], hasMore: false, offset: 0 };
  }

  const url = new URL(request.url);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);

  const { entries, hasMore } = await getAuditLogs(user.organization.id, PAGE_SIZE, offset);

  const conversationIds = entries
    .map((e) => (e.metadata as Record<string, unknown> | null)?.conversationId)
    .filter((id): id is string => typeof id === "string");

  let existingConversationIds: string[] = [];
  if (conversationIds.length > 0) {
    const existing = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(inArray(conversations.id, conversationIds));
    existingConversationIds = existing.map((r) => r.id);
  }

  return { entries, existingConversationIds, hasMore, offset };
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
  const [existingConvIds, setExistingConvIds] = useState(loaderData.existingConversationIds);
  const fetcher = useFetcher<typeof loader>();

  useEffect(() => {
    setEntries(loaderData.entries);
    setHasMore(loaderData.hasMore);
    setExistingConvIds(loaderData.existingConversationIds);
  }, [loaderData.entries, loaderData.hasMore, loaderData.existingConversationIds]);

  useEffect(() => {
    if (fetcher.data) {
      setEntries((prev) => [...prev, ...fetcher.data!.entries]);
      setExistingConvIds((prev) => [...new Set([...prev, ...fetcher.data!.existingConversationIds])]);
      setHasMore(fetcher.data.hasMore);
    }
  }, [fetcher.data]);

  const existingConvSet = new Set(existingConvIds);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/"
            className="p-2 -ml-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <h1 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Settings</h1>
        </div>
      </header>

      <div className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4">
          <nav className="flex gap-6">
            <Link
              to="/settings"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Account
            </Link>
            <Link
              to="/settings/ai-provider"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              AI Provider
            </Link>
            <span className="py-3 text-sm text-neutral-900 dark:text-neutral-100 font-medium border-b-2 border-neutral-900 dark:border-neutral-100">
              Audit Log
            </span>
            <Link
              to="/settings/authentication"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Authentication
            </Link>
            <Link
              to="/settings/github"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              GitHub
            </Link>
            <Link
              to="/settings/organization"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Organization
            </Link>
            <Link
              to="/settings/storage"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Storage
            </Link>
          </nav>
        </div>
      </div>

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
                      {entry.metadata && "conversationId" in entry.metadata && existingConvSet.has(entry.metadata.conversationId as string) ? (
                        <>
                          {entry.action}
                          {" · "}
                          <Link
                            to={`/c/${entry.metadata.conversationId}`}
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
    </div>
  );
}
