import { useState, useEffect, useCallback } from "react";

export type ItemType = "message" | "tool_call" | "tool_output";

export interface Item {
  id: string;
  type: ItemType;
  role?: "user" | "assistant";
  content?: unknown;
  toolCallId?: string;
  status?: "in_progress" | "completed" | "cancelled";
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  items: Item[];
  createdAt: number;
  updatedAt: number;
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from API on mount
  useEffect(() => {
    async function loadConversations() {
      try {
        const response = await fetch("/api/conversations");
        if (response.ok) {
          const data = await response.json();
          setConversations(data);
        }
      } catch {
        // API not available, start with empty
      }
      setIsLoaded(true);
    }
    loadConversations();
  }, []);

  const currentConversation = conversations.find((c) => c.id === currentConversationId) || null;

  const createConversation = useCallback(async () => {
    const id = crypto.randomUUID();
    const newConv: Conversation = {
      id,
      title: "New Chat",
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setConversations((prev) => [newConv, ...prev]);
    setCurrentConversationId(newConv.id);

    try {
      await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title: "New Chat" }),
      });
    } catch {
      // API error
    }

    return newConv;
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
      }

      try {
        await fetch(`/api/conversations?id=${id}`, { method: "DELETE" });
      } catch {
        // API error
      }
    },
    [currentConversationId]
  );

  const renameConversation = useCallback(async (id: string, title: string) => {
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === id ? { ...conv, title, updatedAt: Date.now() } : conv
      )
    );

    try {
      await fetch(`/api/conversations?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    } catch {
      // API error
    }
  }, []);

  const selectConversation = useCallback((id: string) => {
    setCurrentConversationId(id);
  }, []);

  const clearSelection = useCallback(() => {
    setCurrentConversationId(null);
  }, []);

  const addItem = useCallback(async (conversationId: string, item: Item) => {
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== conversationId) return conv;

        const items = [...conv.items, item];

        let title = conv.title;
        if (
          conv.title === "New Chat" &&
          item.type === "message" &&
          item.role === "user"
        ) {
          const text =
            typeof item.content === "string"
              ? item.content
              : (item.content as { text?: string })?.text || "";
          title = text.slice(0, 50).trim() + (text.length > 50 ? "..." : "");
        }

        return {
          ...conv,
          items,
          title,
          updatedAt: Date.now(),
        };
      })
    );

    try {
      await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, item }),
      });
    } catch {
      // API error
    }
  }, []);

  const updateItem = useCallback(
    async (conversationId: string, itemId: string, updates: Partial<Item>) => {
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== conversationId) return conv;

          return {
            ...conv,
            items: conv.items.map((item) =>
              item.id === itemId ? { ...item, ...updates } : item
            ),
            updatedAt: Date.now(),
          };
        })
      );

      try {
        await fetch(`/api/items?id=${itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
      } catch {
        // API error
      }
    },
    []
  );

  const sortedConversations = [...conversations].sort(
    (a, b) => b.updatedAt - a.updatedAt
  );

  return {
    conversations: sortedConversations,
    currentConversation,
    currentConversationId,
    isLoaded,
    createConversation,
    deleteConversation,
    renameConversation,
    selectConversation,
    clearSelection,
    addItem,
    updateItem,
  };
}
