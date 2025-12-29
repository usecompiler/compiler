import { useParams, useOutletContext, useSearchParams, redirect } from "react-router";
import { useRef, useState } from "react";
import type { Route } from "./+types/conversation";
import type { AppContext } from "./app-layout";
import { ConversationLayout } from "~/components/conversation-layout";
import { AgentConversation } from "~/components/agent-conversation";
import { ShareModal } from "~/components/share-modal";
import { requireActiveAuth } from "~/lib/auth.server";
import {
  getConversation,
  getConversationItems,
  isUserInOrg,
  getShareLink,
  createShareLink,
  revokeShareLink,
  getConversationByShareToken,
  createReviewRequest,
  hasPendingReviewRequest,
} from "~/lib/conversations.server";

export function meta() {
  return [
    { title: "Compiler" },
    { name: "description", content: "AI-powered project assistant" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const isOwner = user.membership?.role === "owner";
  const url = new URL(request.url);
  const shareToken = url.searchParams.get("share");

  const conversation = await getConversation(params.id!);
  if (!conversation) {
    throw redirect("/");
  }

  const ownsConversation = conversation.userId === user.id;
  let canAccess = ownsConversation;
  let isSharedView = false;
  let sharedByName: string | null = null;

  if (!ownsConversation && shareToken && user.organization) {
    const shareData = await getConversationByShareToken(shareToken);
    if (shareData && shareData.conversation.id === params.id) {
      const userInOrg = await isUserInOrg(user.id, shareData.organizationId);
      if (userInOrg) {
        canAccess = true;
        isSharedView = true;
        sharedByName = shareData.ownerName;
      }
    }
  }

  if (!canAccess && isOwner && user.organization) {
    canAccess = await isUserInOrg(conversation.userId, user.organization.id);
  }

  if (!canAccess) {
    throw redirect("/");
  }

  const items = await getConversationItems(params.id!);

  let shareLink = null;
  if (ownsConversation) {
    shareLink = await getShareLink(params.id!);
  }

  let isReviewRequest = false;
  if (isSharedView) {
    isReviewRequest = await hasPendingReviewRequest(params.id!, user.id);
  }

  return {
    items,
    isSharedView,
    isReviewRequest,
    ownsConversation,
    sharedByName,
    shareLink: shareLink ? { token: shareLink.token, createdAt: shareLink.createdAt.toISOString() } : null,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const conversation = await getConversation(params.id!);
  if (!conversation || conversation.userId !== user.id) {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }

  if (intent === "create-share") {
    const token = await createShareLink(params.id!);
    return Response.json({ shareToken: token });
  }

  if (intent === "revoke-share") {
    await revokeShareLink(params.id!);
    return Response.json({ shareRevoked: true });
  }

  if (intent === "request-review") {
    const reviewerUserId = formData.get("reviewerUserId")?.toString();
    const shareToken = formData.get("shareToken")?.toString();

    if (!reviewerUserId || !shareToken) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!user.organization) {
      return Response.json({ error: "No organization" }, { status: 400 });
    }

    const reviewerInOrg = await isUserInOrg(reviewerUserId, user.organization.id);
    if (!reviewerInOrg) {
      return Response.json({ error: "Reviewer not in organization" }, { status: 400 });
    }

    await createReviewRequest(params.id!, user.id, reviewerUserId, shareToken);
    return Response.json({ reviewRequested: true });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}

export default function Conversation({ loaderData }: Route.ComponentProps) {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { conversations, user, hasMore, impersonating, orgMembers, reviewers, isOwner, isAdmin, reviewRequests } = useOutletContext<AppContext>();
  const filteredReviewers = reviewers?.filter((r) => r.userId !== user.id) ?? [];
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const initialPrompt = searchParams.get("prompt");
  const hasProcessedInitialPrompt = useRef(false);

  const { items, isSharedView, isReviewRequest, ownsConversation, sharedByName, shareLink } = loaderData;
  const isReadOnly = !!impersonating || isSharedView;

  const handlePromptProcessed = () => {
    if (initialPrompt && !hasProcessedInitialPrompt.current) {
      hasProcessedInitialPrompt.current = true;
      const newParams = new URLSearchParams();
      if (impersonating) {
        newParams.set("impersonate", impersonating.id);
      }
      setSearchParams(newParams, { replace: true });
    }
  };

  const headerRight = (
    <>
      {isSharedView && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400 mr-2">
          Shared by {sharedByName}
        </span>
      )}
      {ownsConversation && (
        <button
          onClick={() => setIsShareModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
          </svg>
          Share
        </button>
      )}
    </>
  );

  return (
    <ConversationLayout
      conversations={conversations}
      user={user}
      hasMore={hasMore}
      impersonating={impersonating}
      orgMembers={orgMembers}
      isOwner={isOwner}
      isAdmin={isAdmin}
      headerRight={(ownsConversation || isSharedView) ? headerRight : undefined}
      reviewRequests={reviewRequests}
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          <AgentConversation
            key={id}
            conversationId={id!}
            initialItems={items}
            initialPrompt={isReadOnly ? null : initialPrompt}
            onInitialPromptProcessed={handlePromptProcessed}
            readOnly={isReadOnly}
            isSharedView={isSharedView}
            isReviewRequest={isReviewRequest}
            ownsConversation={ownsConversation}
            reviewers={filteredReviewers}
            shareLink={shareLink}
            userName={user.name}
            isOwner={isOwner}
          />
        </div>
      </div>

      {ownsConversation && (
        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          conversationId={id!}
          shareLink={shareLink}
        />
      )}
    </ConversationLayout>
  );
}
