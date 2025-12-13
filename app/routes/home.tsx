import type { Route } from "./+types/home";
import { useChats } from "~/lib/chat-storage";
import { ChatLayout } from "~/components/chat-layout";
import { AgentChat } from "~/components/agent-chat";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Gist" },
    { name: "description", content: "AI-powered project assistant" },
  ];
}

export default function Home() {
  const {
    chats,
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
  } = useChats();

  // Don't render until localStorage is loaded to avoid hydration mismatch
  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-900">
        <div className="text-neutral-400">Loading...</div>
      </div>
    );
  }

  return (
    <ChatLayout
      chats={chats}
      currentChatId={currentChatId}
      onSelectChat={selectChat}
      onNewChat={clearSelection}
      onDeleteChat={deleteChat}
      onRenameChat={renameChat}
    >
      <AgentChat
        chatId={currentChatId}
        messages={currentChat?.messages || []}
        onAddMessage={addMessage}
        onUpdateMessage={updateMessage}
        onCreateChat={createChat}
      />
    </ChatLayout>
  );
}
