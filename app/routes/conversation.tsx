import { useNavigate, useParams, useOutletContext, useSearchParams, redirect } from "react-router";
import { useRef } from "react";
import type { Route } from "./+types/conversation";
import type { AppContext } from "./app-layout";
import { ConversationLayout } from "~/components/conversation-layout";
import { AgentConversation } from "~/components/agent-conversation";
import { requireActiveAuth } from "~/lib/auth.server";
import { getConversation, getConversationItems, isUserInOrg } from "~/lib/conversations.server";

export function meta() {
  return [
    { title: "Gist" },
    { name: "description", content: "AI-powered project assistant" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const isOwner = user.membership?.role === "owner";

  // Get conversation to check ownership
  const conversation = await getConversation(params.id!);
  if (!conversation) {
    throw redirect("/");
  }

  // Check access: user owns it, OR user is org owner impersonating someone in same org
  const ownsConversation = conversation.userId === user.id;
  let canAccess = ownsConversation;

  if (!ownsConversation && isOwner && user.organization) {
    // Check if conversation owner is in the same org
    canAccess = await isUserInOrg(conversation.userId, user.organization.id);
  }

  if (!canAccess) {
    throw redirect("/");
  }

  const items = await getConversationItems(params.id!);
  return { items };
}

export default function Conversation({ loaderData }: Route.ComponentProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { conversations, user, hasMore, impersonating, orgMembers, isOwner } = useOutletContext<AppContext>();
  const initialPrompt = searchParams.get("prompt");
  const hasProcessedInitialPrompt = useRef(false);

  // Clear prompt from URL after it's been processed
  const handlePromptProcessed = () => {
    if (initialPrompt && !hasProcessedInitialPrompt.current) {
      hasProcessedInitialPrompt.current = true;
      // Keep impersonate param if present
      const newParams = new URLSearchParams();
      if (impersonating) {
        newParams.set("impersonate", impersonating.id);
      }
      setSearchParams(newParams, { replace: true });
    }
  };

  const handleSelectConversation = (convId: string) => {
    const impersonateParam = impersonating ? `?impersonate=${impersonating.id}` : "";
    navigate(`/c/${convId}${impersonateParam}`);
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
      impersonating={impersonating}
      orgMembers={orgMembers}
      isOwner={isOwner}
    >
      <AgentConversation
        key={id}
        conversationId={id!}
        initialItems={loaderData.items}
        initialPrompt={impersonating ? null : initialPrompt}
        onInitialPromptProcessed={handlePromptProcessed}
        readOnly={!!impersonating}
      />
    </ConversationLayout>
  );
}
