import { useNavigate, useParams, useOutletContext } from "react-router";
import { useEffect } from "react";
import type { AppContext } from "./app-layout";
import { ConversationLayout } from "~/components/conversation-layout";
import { AgentConversation } from "~/components/agent-conversation";

export function meta() {
  return [
    { title: "Gist" },
    { name: "description", content: "AI-powered project assistant" },
  ];
}

export default function Conversation() {
  const params = useParams();
  const navigate = useNavigate();
  const conversationIdFromUrl = params.id || null;

  const {
    conversations,
    currentConversation,
    currentConversationId,
    user,
    createConversation,
    deleteConversation,
    renameConversation,
    selectConversation,
    clearSelection,
    addItem,
    updateItem,
  } = useOutletContext<AppContext>();

  // Select conversation from URL
  useEffect(() => {
    if (!conversationIdFromUrl) return;

    const exists = conversations.some((c) => c.id === conversationIdFromUrl);
    if (exists) {
      if (currentConversationId !== conversationIdFromUrl) {
        selectConversation(conversationIdFromUrl);
      }
    } else {
      // Conversation doesn't exist, redirect to home
      navigate("/", { replace: true });
    }
  }, [conversationIdFromUrl, conversations, currentConversationId, selectConversation, navigate]);

  const handleSelectConversation = (id: string) => {
    selectConversation(id);
    navigate(`/c/${id}`);
  };

  const handleNewConversation = () => {
    clearSelection();
    navigate("/");
  };

  const handleDeleteConversation = async (id: string) => {
    await deleteConversation(id);
    if (id === currentConversationId) {
      navigate("/");
    }
  };

  const handleCreateConversation = async () => {
    const newConv = await createConversation();
    navigate(`/c/${newConv.id}`);
    return newConv;
  };

  return (
    <ConversationLayout
      conversations={conversations}
      currentConversationId={currentConversationId}
      onSelectConversation={handleSelectConversation}
      onNewConversation={handleNewConversation}
      onDeleteConversation={handleDeleteConversation}
      onRenameConversation={renameConversation}
      user={user}
    >
      <AgentConversation
        conversationId={currentConversationId}
        items={currentConversation?.items || []}
        onAddItem={addItem}
        onUpdateItem={updateItem}
        onCreateConversation={handleCreateConversation}
      />
    </ConversationLayout>
  );
}
