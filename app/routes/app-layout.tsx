import { Outlet, useLoaderData } from "react-router";
import { useState, useCallback, useEffect } from "react";
import type { Route } from "./+types/app-layout";
import { requireAuth } from "~/lib/auth.server";
import { getConversationsWithItems } from "~/lib/conversations.server";
import type { Item, Conversation } from "~/lib/conversations.server";

// Re-export types for use by other components
export type { Item, Conversation, ItemType } from "~/lib/conversations.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAuth(request);
  const conversations = await getConversationsWithItems(user.id);
  return { user, conversations };
}

// Type for the outlet context
export interface AppContext {
  conversations: Conversation[];
  currentConversationId: string | null;
  currentConversation: Conversation | null;
  user: { id: string; email: string; name: string };
  selectConversation: (id: string) => void;
  clearSelection: () => void;
  createConversation: () => Promise<Conversation>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  addItem: (conversationId: string, item: Item) => Promise<void>;
  updateItem: (conversationId: string, itemId: string, updates: Partial<Item>) => Promise<void>;
}

export default function AppLayout() {
  const loaderData = useLoaderData<typeof loader>();

  // Local state for real-time updates (synced with loader data)
  const [conversations, setConversations] = useState<Conversation[]>(loaderData.conversations);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  // Sync with loader data when it changes (after revalidation)
  useEffect(() => {
    setConversations(loaderData.conversations);
  }, [loaderData.conversations]);

  const currentConversation = conversations.find((c) => c.id === currentConversationId) || null;

  const selectConversation = useCallback((id: string) => {
    setCurrentConversationId(id);
  }, []);

  const clearSelection = useCallback(() => {
    setCurrentConversationId(null);
  }, []);

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
    setCurrentConversationId(id);

    await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title: "New Chat" }),
    });

    return newConv;
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
      }

      await fetch(`/api/conversations?id=${id}`, { method: "DELETE" });
    },
    [currentConversationId]
  );

  const renameConversation = useCallback(async (id: string, title: string) => {
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === id ? { ...conv, title, updatedAt: Date.now() } : conv
      )
    );

    await fetch(`/api/conversations?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
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

    await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, item }),
    });
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

      await fetch(`/api/items?id=${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    },
    []
  );

  const sortedConversations = [...conversations].sort(
    (a, b) => b.updatedAt - a.updatedAt
  );

  const context: AppContext = {
    conversations: sortedConversations,
    currentConversationId,
    currentConversation,
    user: loaderData.user,
    selectConversation,
    clearSelection,
    createConversation,
    deleteConversation,
    renameConversation,
    addItem,
    updateItem,
  };

  return <Outlet context={context} />;
}
