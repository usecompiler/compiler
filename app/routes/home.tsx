import type { Route } from "./+types/home";
import { useConversations } from "~/lib/conversation-storage";
import { ConversationLayout } from "~/components/conversation-layout";
import { AgentConversation } from "~/components/agent-conversation";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Gist" },
    { name: "description", content: "AI-powered project assistant" },
  ];
}

export default function Home() {
  const {
    conversations,
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
  } = useConversations();

  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-900">
        <div className="text-neutral-400">Loading...</div>
      </div>
    );
  }

  return (
    <ConversationLayout
      conversations={conversations}
      currentConversationId={currentConversationId}
      onSelectConversation={selectConversation}
      onNewConversation={clearSelection}
      onDeleteConversation={deleteConversation}
      onRenameConversation={renameConversation}
    >
      <AgentConversation
        conversationId={currentConversationId}
        items={currentConversation?.items || []}
        onAddItem={addItem}
        onUpdateItem={updateItem}
        onCreateConversation={createConversation}
      />
    </ConversationLayout>
  );
}
