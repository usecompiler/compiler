import { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { Sidebar } from "./sidebar";
import { ModelSelector } from "./model-selector";
import type { ConversationMeta, Member, ImpersonatingUser, ReviewRequest, ModelOption } from "~/routes/app-layout";
import type { User } from "~/lib/auth.server";

interface ConversationLayoutProps {
  conversations: ConversationMeta[];
  user: User;
  hasMore: boolean;
  impersonating: ImpersonatingUser | null;
  orgMembers: Member[];
  isOwner: boolean;
  isAdmin: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  reviewRequests?: ReviewRequest[];
  availableModels?: ModelOption[];
  defaultModel?: string;
  userPreferredModel?: string | null;
}

export function ConversationLayout({
  conversations,
  user,
  hasMore,
  impersonating,
  orgMembers,
  isOwner,
  isAdmin,
  headerRight,
  children,
  reviewRequests = [],
  availableModels = [],
  defaultModel = "claude-sonnet-4-20250514",
  userPreferredModel,
}: ConversationLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentModel, setCurrentModel] = useState(
    userPreferredModel || defaultModel
  );
  const location = useLocation();
  const navigate = useNavigate();

  const handleModelChange = useCallback(async (modelId: string) => {
    setCurrentModel(modelId);
    try {
      await fetch("/api/user-model-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      });
    } catch (error) {
      console.error("Failed to save model preference:", error);
    }
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        navigate("/");
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  return (
    <div className="flex h-dvh pt-safe bg-neutral-50 dark:bg-neutral-900">
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
          user={user}
          hasMore={hasMore}
          impersonating={impersonating}
          orgMembers={orgMembers}
          isOwner={isOwner}
          isAdmin={isAdmin}
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
            <ModelSelector
              availableModels={availableModels}
              currentModel={currentModel}
              onModelChange={handleModelChange}
            />
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
