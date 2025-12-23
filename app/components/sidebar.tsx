import { useState, useEffect, useRef } from "react";
import { useNavigate, useFetcher, Link, NavLink, useParams } from "react-router";
import type { ConversationMeta, Member, ImpersonatingUser, ReviewRequest } from "~/routes/app-layout";
import { CommandPalette } from "./command-palette";
import type { User } from "~/lib/auth.server";

function buildConversationUrl(id: string, impersonating: ImpersonatingUser | null, shareToken?: string): string {
  const params = new URLSearchParams();
  if (impersonating) params.set("impersonate", impersonating.id);
  if (shareToken) params.set("share", shareToken);
  const query = params.toString();
  return `/c/${id}${query ? `?${query}` : ""}`;
}

interface SidebarProps {
  conversations: ConversationMeta[];
  user: User;
  hasMore: boolean;
  impersonating: ImpersonatingUser | null;
  orgMembers: Member[];
  isOwner: boolean;
  reviewRequests?: ReviewRequest[];
}

export function Sidebar({
  conversations: initialConversations,
  user,
  hasMore: initialHasMore,
  impersonating,
  orgMembers,
  isOwner,
  reviewRequests = [],
}: SidebarProps) {
  const { id: currentConversationId } = useParams();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [conversations, setConversations] = useState(initialConversations);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const fetcher = useFetcher<{ conversations: ConversationMeta[]; hasMore: boolean }>();
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConversations(initialConversations);
    setHasMore(initialHasMore);
  }, [initialConversations, initialHasMore]);

  useEffect(() => {
    if (fetcher.data) {
      setConversations((prev) => [...prev, ...fetcher.data!.conversations]);
      setHasMore(fetcher.data.hasMore);
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (!loadMoreRef.current || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && fetcher.state === "idle" && hasMore) {
          const impersonateParam = impersonating ? `&impersonate=${impersonating.id}` : "";
          fetcher.load(`/api/conversations?offset=${conversations.length}${impersonateParam}`);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, conversations.length, fetcher, impersonating]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isLoadingMore = fetcher.state === "loading";

  return (
    <aside className="w-64 h-full bg-neutral-100 dark:bg-black flex flex-col">
      <div className="p-3 space-y-1">
        {!impersonating && (
          <Link
            to="/"
            prefetch="intent"
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-neutral-900 dark:text-neutral-100 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
          >
            <svg
              className="w-5 h-5 text-neutral-600 dark:text-neutral-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
              />
            </svg>
            New conversation
          </Link>
        )}

        <button
          onClick={() => setIsSearchOpen(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-neutral-900 dark:text-neutral-100 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
        >
          <svg
            className="w-5 h-5 text-neutral-600 dark:text-neutral-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          Search conversations
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 scrollbar-hide">
        {reviewRequests.length > 0 && !impersonating && (
          <>
            <p className="px-3 py-2 text-xs text-neutral-400 dark:text-neutral-500">
              Review requested
            </p>
            <nav className="space-y-0.5 mb-4">
              {reviewRequests.map((request) => (
                <ReviewRequestItem
                  key={request.id}
                  request={request}
                />
              ))}
            </nav>
          </>
        )}
        <p className="px-3 py-2 text-xs text-neutral-400 dark:text-neutral-500">
          {impersonating ? `${impersonating.name}'s chats` : "Your chats"}
        </p>
        <nav className="space-y-0.5">
          {conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              readOnly={!!impersonating}
              impersonating={impersonating}
            />
          ))}

          {isLoadingMore && <ConversationSkeletons count={3} />}

          {hasMore && !isLoadingMore && <div ref={loadMoreRef} className="h-4" />}
        </nav>
      </div>

      <AccountMenu user={user} isOwner={isOwner} orgMembers={orgMembers} impersonating={impersonating} />

      <CommandPalette
        conversations={conversations}
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        impersonateUserId={impersonating?.id}
      />
    </aside>
  );
}

interface ReviewRequestItemProps {
  request: ReviewRequest;
}

function ReviewRequestItem({ request }: ReviewRequestItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const fetcher = useFetcher();

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [isOpen]);

  const handleDismiss = (e: React.MouseEvent) => {
    e.preventDefault();
    fetcher.submit(null, {
      method: "PATCH",
      action: `/api/conversations?reviewRequestId=${request.id}`,
    });
    setIsOpen(false);
  };

  const isPending = fetcher.state !== "idle";

  return (
    <NavLink
      to={`/c/${request.conversationId}?share=${request.shareToken}`}
      prefetch="intent"
      className={({ isActive }) => `group relative flex items-center px-3 py-2.5 text-sm rounded-lg transition-colors ${
        isActive
          ? "bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
          : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
      } ${isPending ? "opacity-50" : ""}`}
    >
      <span className="flex-1 truncate pr-6">{request.conversationTitle}</span>

      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`absolute right-2 p-1 text-neutral-400 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-opacity ${
          isOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg py-1 z-50"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            onClick={handleDismiss}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
            Dismiss
          </button>
        </div>
      )}
    </NavLink>
  );
}

function ConversationSkeletons({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center px-3 py-2.5 rounded-lg">
          <div className="flex-1">
            <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse w-3/4" />
          </div>
        </div>
      ))}
    </>
  );
}

interface ConversationItemProps {
  conversation: ConversationMeta;
  readOnly?: boolean;
  impersonating: ImpersonatingUser | null;
}

function ConversationItem({ conversation, readOnly = false, impersonating }: ConversationItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const { id: currentId } = useParams();

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [isOpen]);

  const handleRename = (e: React.MouseEvent) => {
    e.preventDefault();
    const newTitle = window.prompt("Rename conversation", conversation.title);
    if (newTitle?.trim()) {
      fetcher.submit(
        { title: newTitle.trim() },
        {
          method: "PATCH",
          action: `/api/conversations?id=${conversation.id}`,
          encType: "application/json",
        }
      );
    }
    setIsOpen(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    if (confirm("Delete this conversation?")) {
      fetcher.submit(null, {
        method: "DELETE",
        action: `/api/conversations?id=${conversation.id}`,
      });
      if (currentId === conversation.id) {
        navigate("/");
      }
    }
    setIsOpen(false);
  };

  const isPending = fetcher.state !== "idle";
  const conversationUrl = buildConversationUrl(conversation.id, impersonating);

  return (
    <NavLink
      to={conversationUrl}
      prefetch="intent"
      className={({ isActive }) => `group relative flex items-center px-3 py-2.5 text-sm rounded-lg transition-colors ${
        isActive
          ? "bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
          : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
      } ${isPending ? "opacity-50" : ""}`}
    >
      <span className={`flex-1 truncate ${readOnly ? "" : "pr-6"}`}>{conversation.title}</span>

      {!readOnly && (
        <>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
            className={`absolute right-2 p-1 text-neutral-400 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-opacity ${
              isOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>

          {isOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg py-1 z-50"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <button
                onClick={handleRename}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                </svg>
                Rename
              </button>
              <button
                onClick={handleDelete}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 dark:text-red-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-red-600 dark:hover:text-red-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
                Delete
              </button>
            </div>
          )}
        </>
      )}
    </NavLink>
  );
}

interface AccountMenuProps {
  user: User;
  isOwner: boolean;
  orgMembers: Member[];
  impersonating: ImpersonatingUser | null;
}

function AccountMenu({ user, isOwner, orgMembers, impersonating }: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isImpersonateHovered, setIsImpersonateHovered] = useState(false);
  const navigate = useNavigate();
  const fetcher = useFetcher();

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [isOpen]);

  const displayUser = impersonating || user;
  const initials = displayUser.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleLogout = () => {
    fetcher.submit(null, { method: "post", action: "/logout" });
  };

  const otherMembers = orgMembers.filter((m) => m.userId !== user.id);
  const showImpersonate = isOwner && otherMembers.length > 0;

  if (impersonating) {
    return (
      <div className="p-3 border-t border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-[10px] font-medium text-orange-600 dark:text-orange-400">
            {initials}
          </div>
          <span className="flex-1 text-sm text-neutral-600 dark:text-neutral-300 truncate">{impersonating.name}</span>
          <Link
            to="/"
            className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          >
            Stop
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative p-3 border-t border-neutral-200 dark:border-neutral-800">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
      >
        <div className="w-6 h-6 rounded-full bg-neutral-300 dark:bg-neutral-600 flex items-center justify-center text-[10px] font-medium text-neutral-700 dark:text-neutral-200">
          {initials}
        </div>
        <span>{user.name}</span>
      </button>

      {isOpen && (
        <div
          className="absolute left-3 right-3 bottom-full mb-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg overflow-visible z-50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-3 border-b border-neutral-200 dark:border-neutral-700">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-neutral-300 dark:bg-neutral-600 flex items-center justify-center text-xs font-medium text-neutral-700 dark:text-neutral-200">
                {initials}
              </div>
              <div>
                <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{user.name}</div>
                <div className="text-xs text-neutral-400 dark:text-neutral-500">{user.email}</div>
              </div>
            </div>
          </div>

          <div className="py-1 border-b border-neutral-200 dark:border-neutral-700">
            <Link
              to="/settings"
              prefetch="intent"
              onClick={(e) => e.stopPropagation()}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              <svg className="w-5 h-5 text-neutral-500 dark:text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              Settings
            </Link>
          </div>

          <div className="py-1">
            {showImpersonate && (
              <div
                className="relative"
                onMouseEnter={() => setIsImpersonateHovered(true)}
                onMouseLeave={() => setIsImpersonateHovered(false)}
              >
                <button
                  className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  <div className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-neutral-500 dark:text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                    </svg>
                    Impersonate
                  </div>
                  <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </button>

                {isImpersonateHovered && (
                  <div className="absolute left-full top-0 -ml-2 pl-3 pt-0">
                    <div className="w-48 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg py-1 max-h-64 overflow-y-auto">
                      {otherMembers.map((member) => (
                        <Link
                          key={member.userId}
                          to={`/?impersonate=${member.userId}`}
                          onClick={() => setIsOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                        >
                          <div className="w-6 h-6 rounded-full bg-neutral-300 dark:bg-neutral-600 flex items-center justify-center text-[10px] font-medium text-neutral-700 dark:text-neutral-200">
                            {member.user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{member.user.name}</div>
                            {member.isDeactivated && (
                              <span className="text-xs text-red-500">Deactivated</span>
                            )}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              <svg className="w-5 h-5 text-neutral-500 dark:text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
              </svg>
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
