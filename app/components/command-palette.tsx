import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router";
import type { ConversationMeta } from "~/routes/app-layout";

interface SearchResult {
  id: string;
  title: string;
  matchType: "title" | "content";
  snippet?: string;
  updatedAt: number;
}

interface CommandPaletteProps {
  conversations: ConversationMeta[];
  isOpen: boolean;
  onClose: () => void;
  impersonateUserId?: string | null;
}

function buildConversationUrl(id: string, impersonateUserId?: string | null): string {
  return impersonateUserId ? `/c/${id}?impersonate=${impersonateUserId}` : `/c/${id}`;
}

type TimeGroup = "Today" | "Yesterday" | "Previous 7 Days" | "Previous 30 Days" | "Older";

function getTimeGroup(timestamp: number): TimeGroup {
  const now = new Date();
  const date = new Date(timestamp);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const startOf7Days = new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOf30Days = new Date(startOfToday.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (date >= startOfToday) return "Today";
  if (date >= startOfYesterday) return "Yesterday";
  if (date >= startOf7Days) return "Previous 7 Days";
  if (date >= startOf30Days) return "Previous 30 Days";
  return "Older";
}

function groupByTime(results: SearchResult[]): Map<TimeGroup, SearchResult[]> {
  const groups = new Map<TimeGroup, SearchResult[]>();
  const order: TimeGroup[] = ["Today", "Yesterday", "Previous 7 Days", "Previous 30 Days", "Older"];

  for (const group of order) {
    groups.set(group, []);
  }

  for (const result of results) {
    const group = getTimeGroup(result.updatedAt);
    groups.get(group)!.push(result);
  }

  return groups;
}

export function CommandPalette({
  conversations,
  isOpen,
  onClose,
  impersonateUserId,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const params = new URLSearchParams({ q: searchQuery, limit: "15" });
      if (impersonateUserId) {
        params.set("impersonate", impersonateUserId);
      }
      const response = await fetch(`/api/search?${params}`);
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data.results);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [impersonateUserId]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.trim()) {
      debounceRef.current = setTimeout(() => {
        performSearch(query);
      }, 150);
    } else {
      setSearchResults([]);
      setIsSearching(false);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, performSearch]);

  const displayedResults: SearchResult[] = query.trim() ? searchResults : conversations.map(c => ({
    id: c.id,
    title: c.title,
    matchType: "title" as const,
    updatedAt: c.updatedAt,
  }));

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, searchResults]);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSearchResults([]);
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const hasNewChatOption = !query;
  const totalItems = (hasNewChatOption ? 1 : 0) + displayedResults.length;

  useEffect(() => {
    const selected = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, totalItems - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (hasNewChatOption && selectedIndex === 0) {
          navigate("/");
          onClose();
        } else {
          const resultIndex = hasNewChatOption ? selectedIndex - 1 : selectedIndex;
          if (displayedResults[resultIndex]) {
            navigate(buildConversationUrl(displayedResults[resultIndex].id, impersonateUserId));
            onClose();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, totalItems, hasNewChatOption, selectedIndex, displayedResults, navigate, impersonateUserId]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-neutral-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats..."
            className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 outline-none text-base"
          />
          <button
            onClick={onClose}
            className="ml-4 p-1 rounded-full text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <hr className="border-neutral-200 dark:border-neutral-700" />

        <div ref={listRef} className="max-h-96 overflow-y-auto px-3 py-3 scrollbar-thin scrollbar-thumb-neutral-300 dark:scrollbar-thumb-neutral-600 scrollbar-track-transparent">
          {hasNewChatOption && (
            <Link
              to="/"
              prefetch="intent"
              onClick={onClose}
              data-index={0}
              className={`w-full flex items-center gap-3 px-3 py-3 mb-2 text-left text-sm text-neutral-900 dark:text-neutral-100 rounded-xl transition-colors ${
                selectedIndex === 0 ? "bg-neutral-100 dark:bg-neutral-700" : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
              </svg>
              New chat
            </Link>
          )}

          {isSearching && query.trim() ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">
              Searching...
            </div>
          ) : displayedResults.length === 0 && query.trim() ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">
              No conversations found
            </div>
          ) : query.trim() ? (
            <div className="space-y-0.5">
              {displayedResults.map((result, index) => {
                const itemIndex = hasNewChatOption ? index + 1 : index;
                const isSelected = selectedIndex === itemIndex;
                return (
                  <Link
                    key={result.id}
                    to={buildConversationUrl(result.id, impersonateUserId)}
                    prefetch="intent"
                    onClick={onClose}
                    data-index={itemIndex}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 text-left text-sm rounded-xl transition-colors ${
                      isSelected
                        ? "bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100"
                        : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
                    }`}
                  >
                    <svg className="w-5 h-5 flex-shrink-0 text-neutral-400 dark:text-neutral-500 mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      {result.matchType === "content" ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
                      )}
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{result.title}</div>
                      {result.snippet && (
                        <div className="text-xs text-neutral-400 dark:text-neutral-500 truncate mt-0.5">
                          {result.snippet}
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="space-y-0.5">
              {(() => {
                const grouped = groupByTime(displayedResults);
                let flatIndex = 0;
                return Array.from(grouped.entries()).map(([group, items]) => {
                  if (items.length === 0) return null;
                  const groupItems = items.map((result) => {
                    const currentIndex = flatIndex++;
                    const itemIndex = hasNewChatOption ? currentIndex + 1 : currentIndex;
                    const isSelected = selectedIndex === itemIndex;
                    return (
                      <Link
                        key={result.id}
                        to={buildConversationUrl(result.id, impersonateUserId)}
                        prefetch="intent"
                        onClick={onClose}
                        data-index={itemIndex}
                        className={`w-full flex items-start gap-3 px-3 py-2.5 text-left text-sm rounded-xl transition-colors ${
                          isSelected
                            ? "bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100"
                            : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
                        }`}
                      >
                        <svg className="w-5 h-5 flex-shrink-0 text-neutral-400 dark:text-neutral-500 mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{result.title}</div>
                        </div>
                      </Link>
                    );
                  });
                  return (
                    <div key={group}>
                      <div className="px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                        {group}
                      </div>
                      {groupItems}
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
