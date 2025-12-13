import { useState, useEffect } from "react";
import { Sidebar } from "./sidebar";
import type { Chat } from "~/lib/chat-storage";

interface ChatLayoutProps {
  chats: Chat[];
  currentChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  children: React.ReactNode;
}

export function ChatLayout({
  chats,
  currentChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  children,
}: ChatLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Keyboard shortcut: Cmd/Ctrl+Shift+O for new chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        onNewChat();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onNewChat]);

  return (
    <div className="flex h-screen bg-neutral-900">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed lg:static inset-y-0 left-0 z-30 transform transition-transform duration-200 lg:transform-none ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <Sidebar
          chats={chats}
          currentChatId={currentChatId}
          onSelectChat={(id) => {
            onSelectChat(id);
            setSidebarOpen(false);
          }}
          onNewChat={() => {
            onNewChat();
            setSidebarOpen(false);
          }}
          onDeleteChat={onDeleteChat}
          onRenameChat={onRenameChat}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="h-14 flex items-center px-4">
          {/* Mobile menu button */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 -ml-2 mr-2 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 rounded-lg transition-colors"
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
          <span className="text-neutral-100 text-lg">Gist</span>
        </header>

        {/* Chat area */}
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
