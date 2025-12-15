import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ConversationMeta } from "~/routes/app-layout";

interface CommandPaletteProps {
  conversations: ConversationMeta[];
  isOpen: boolean;
  onClose: () => void;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
}

export function CommandPalette({
  conversations,
  isOpen,
  onClose,
  onSelectConversation,
  onNewConversation,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredConversations = query
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(query.toLowerCase())
      )
    : conversations;

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Calculate total items: "New chat" (when no query) + filtered conversations
  const hasNewChatOption = !query;
  const totalItems = (hasNewChatOption ? 1 : 0) + filteredConversations.length;

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % totalItems);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + totalItems) % totalItems);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (hasNewChatOption && selectedIndex === 0) {
          onNewConversation();
          onClose();
        } else {
          const convIndex = hasNewChatOption ? selectedIndex - 1 : selectedIndex;
          if (filteredConversations[convIndex]) {
            onSelectConversation(filteredConversations[convIndex].id);
            onClose();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, totalItems, hasNewChatOption, selectedIndex, filteredConversations, onNewConversation, onSelectConversation]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-neutral-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-4">
          <svg
            className="w-5 h-5 text-neutral-400 dark:text-neutral-500"
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
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats..."
            className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 outline-none text-base"
          />
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto px-3 pb-3 scrollbar-thin scrollbar-thumb-neutral-300 dark:scrollbar-thumb-neutral-600 scrollbar-track-transparent">
          {/* New conversation option - always shown first when no query */}
          {hasNewChatOption && (
            <button
              onClick={() => {
                onNewConversation();
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-3 py-3 mb-2 text-left text-sm text-neutral-900 dark:text-neutral-100 rounded-xl transition-colors ${
                selectedIndex === 0 ? "bg-neutral-100 dark:bg-neutral-700" : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
              </svg>
              New chat
            </button>
          )}

          {filteredConversations.length === 0 && query ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">
              No conversations found
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredConversations.map((conversation, index) => {
                const itemIndex = hasNewChatOption ? index + 1 : index;
                const isSelected = selectedIndex === itemIndex;
                return (
                <button
                  key={conversation.id}
                  onClick={() => {
                    onSelectConversation(conversation.id);
                    onClose();
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm rounded-xl transition-colors overflow-hidden ${
                    isSelected
                      ? "bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100"
                      : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
                  }`}
                >
                  <svg className="w-5 h-5 flex-shrink-0 text-neutral-400 dark:text-neutral-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
                  </svg>
                  <span className="flex-1 min-w-0 truncate">{conversation.title}</span>
                </button>
              );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
