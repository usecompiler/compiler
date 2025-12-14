import { useNavigate, useParams, useOutletContext, useSearchParams } from "react-router";
import { useRef } from "react";
import type { Route } from "./+types/conversation";
import type { AppContext } from "./app-layout";
import { ConversationLayout } from "~/components/conversation-layout";
import { AgentConversation } from "~/components/agent-conversation";
import { requireAuth } from "~/lib/auth.server";
import { getConversationItems } from "~/lib/conversations.server";

export function meta() {
  return [
    { title: "Gist" },
    { name: "description", content: "AI-powered project assistant" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAuth(request);
  const items = await getConversationItems(params.id!);
  return { items };
}

export default function Conversation({ loaderData }: Route.ComponentProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { conversations, user, hasMore } = useOutletContext<AppContext>();
  const initialPrompt = searchParams.get("prompt");
  const hasProcessedInitialPrompt = useRef(false);

  // Clear prompt from URL after it's been processed
  const handlePromptProcessed = () => {
    if (initialPrompt && !hasProcessedInitialPrompt.current) {
      hasProcessedInitialPrompt.current = true;
      setSearchParams({}, { replace: true });
    }
  };

  const handleSelectConversation = (convId: string) => {
    navigate(`/c/${convId}`);
  };

  const handleNewConversation = () => {
    navigate("/");
  };

  return (
    <ConversationLayout
      conversations={conversations}
      currentConversationId={id || null}
      onSelectConversation={handleSelectConversation}
      onNewConversation={handleNewConversation}
      user={user}
      hasMore={hasMore}
    >
      <AgentConversation
        key={id}
        conversationId={id!}
        initialItems={loaderData.items}
        initialPrompt={initialPrompt}
        onInitialPromptProcessed={handlePromptProcessed}
      />
    </ConversationLayout>
  );
}
