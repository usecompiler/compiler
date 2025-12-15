import { useState, useEffect } from "react";
import { Sidebar } from "./sidebar";
import type { ConversationMeta, Member, ImpersonatingUser, ReviewRequest } from "~/routes/app-layout";
import type { User } from "~/lib/auth.server";

interface ConversationLayoutProps {
  conversations: ConversationMeta[];
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  user: User;
  hasMore: boolean;
  impersonating: ImpersonatingUser | null;
  orgMembers: Member[];
  isOwner: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  reviewRequests?: ReviewRequest[];
}

export function ConversationLayout({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  user,
  hasMore,
  impersonating,
  orgMembers,
  isOwner,
  headerRight,
  children,
  reviewRequests = [],
}: ConversationLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        onNewConversation();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onNewConversation]);

  return (
    <div className="flex h-screen bg-neutral-50 dark:bg-neutral-900">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={`fixed lg:static inset-y-0 left-0 z-30 transform transition-transform duration-200 lg:transform-none ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <Sidebar
          conversations={conversations}
          currentConversationId={currentConversationId}
          onSelectConversation={(id) => {
            onSelectConversation(id);
            setSidebarOpen(false);
          }}
          onNewConversation={() => {
            onNewConversation();
            setSidebarOpen(false);
          }}
          user={user}
          hasMore={hasMore}
          impersonating={impersonating}
          orgMembers={orgMembers}
          isOwner={isOwner}
          reviewRequests={reviewRequests}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0 relative">
        <header className="h-14 flex items-center justify-between px-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 -ml-2 mr-2 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200 rounded-lg transition-colors dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-700"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
            <span className="text-neutral-900 dark:text-neutral-100 text-lg">Gist</span>
          </div>
          {headerRight && (
            <div className="flex items-center">
              {headerRight}
            </div>
          )}
        </header>

        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
