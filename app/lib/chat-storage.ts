import { useState, useEffect, useCallback } from "react";

export interface ToolCall {
  tool: string;
  input?: unknown;
  result?: string;
}

export interface MessageStats {
  toolUses: number;
  tokens: number;
  durationMs: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  stats?: MessageStats;
  contentSplitIndex?: number; // Index where tool use started, to split planning/answer
  cancelled?: boolean;
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "gist-chats";
const CURRENT_CHAT_KEY = "gist-current-chat";

function loadChats(): Chat[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveChats(chats: Chat[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
}

function loadCurrentChatId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CURRENT_CHAT_KEY);
}

function saveCurrentChatId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) {
    localStorage.setItem(CURRENT_CHAT_KEY, id);
  } else {
    localStorage.removeItem(CURRENT_CHAT_KEY);
  }
}

function generateTitle(content: string): string {
  const cleaned = content.slice(0, 50).trim();
  return cleaned.length < content.length ? `${cleaned}...` : cleaned;
}

export function useChats() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    setChats(loadChats());
    setCurrentChatId(loadCurrentChatId());
    setIsLoaded(true);
  }, []);

  // Save chats whenever they change
  useEffect(() => {
    if (isLoaded) {
      saveChats(chats);
    }
  }, [chats, isLoaded]);

  // Save current chat ID whenever it changes
  useEffect(() => {
    if (isLoaded) {
      saveCurrentChatId(currentChatId);
    }
  }, [currentChatId, isLoaded]);

  const currentChat = chats.find((c) => c.id === currentChatId) || null;

  const createChat = useCallback(() => {
    const newChat: Chat = {
      id: crypto.randomUUID(),
      title: "New Chat",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setChats((prev) => [newChat, ...prev]);
    setCurrentChatId(newChat.id);
    return newChat;
  }, []);

  const deleteChat = useCallback(
    (id: string) => {
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (currentChatId === id) {
        setCurrentChatId(null);
      }
    },
    [currentChatId]
  );

  const renameChat = useCallback((id: string, title: string) => {
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === id ? { ...chat, title, updatedAt: Date.now() } : chat
      )
    );
  }, []);

  const selectChat = useCallback((id: string) => {
    setCurrentChatId(id);
  }, []);

  const clearSelection = useCallback(() => {
    setCurrentChatId(null);
  }, []);

  const addMessage = useCallback(
    (chatId: string, message: Message) => {
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id !== chatId) return chat;

          const messages = [...chat.messages, message];
          const title =
            chat.title === "New Chat" && message.role === "user"
              ? generateTitle(message.content)
              : chat.title;

          return {
            ...chat,
            messages,
            title,
            updatedAt: Date.now(),
          };
        })
      );
    },
    []
  );

  const updateMessage = useCallback(
    (chatId: string, messageId: string, updates: Partial<Message>) => {
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id !== chatId) return chat;

          return {
            ...chat,
            messages: chat.messages.map((msg) =>
              msg.id === messageId ? { ...msg, ...updates } : msg
            ),
            updatedAt: Date.now(),
          };
        })
      );
    },
    []
  );

  // Sort chats by most recently updated
  const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    chats: sortedChats,
    currentChat,
    currentChatId,
    isLoaded,
    createChat,
    deleteChat,
    renameChat,
    selectChat,
    clearSelection,
    addMessage,
    updateMessage,
  };
}
