import { useParams, useOutletContext, useSearchParams, redirect, useNavigate, useFetcher } from "react-router";
import { useRef, useState, useEffect } from "react";
import type { Route } from "./+types/conversation";
import type { AppContext } from "./app-layout";
import { ConversationLayout } from "~/components/conversation-layout";
import { AgentConversation } from "~/components/agent-conversation";
import { ShareModal } from "~/components/share-modal";
import { requireActiveAuth } from "~/lib/auth.server";
import { canManageOrganization } from "~/lib/permissions";
import {
  getConversation,
  getConversationItems,
  getConversationBlobs,
  isUserInOrg,
  getShareLink,
  createShareLink,
  revokeShareLink,
  getConversationByShareToken,
  duplicateConversation,
} from "~/lib/conversations.server";
import { logAuditEvent } from "~/lib/audit.server";

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
  const impersonateUserId = url.searchParams.get("impersonate");

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

  if (!canAccess && canManageOrganization(user.membership?.role) && user.organization) {
    if (impersonateUserId && conversation.userId === impersonateUserId) {
      canAccess = await isUserInOrg(impersonateUserId, user.organization.id);
    } else if (isOwner) {
      canAccess = await isUserInOrg(conversation.userId, user.organization.id);
    }
  }

  if (!canAccess) {
    throw redirect("/");
  }

  const [items, blobsByItemId] = await Promise.all([
    getConversationItems(params.id!),
    getConversationBlobs(params.id!),
  ]);

  let shareLink = null;
  if (ownsConversation) {
    shareLink = await getShareLink(params.id!);
  }

  let source: { id: string; title: string; shareToken: string | null } | null = null;
  if (ownsConversation && conversation.conversationId) {
    const sourceConv = await getConversation(conversation.conversationId);
    if (sourceConv) {
      const sourceShare = await getShareLink(conversation.conversationId);
      source = { id: sourceConv.id, title: sourceConv.title, shareToken: sourceShare?.token ?? null };
    }
  }

  return {
    items,
    blobsByItemId,
    isSharedView,
    ownsConversation,
    sharedByName,
    shareLink: shareLink ? { token: shareLink.token, createdAt: shareLink.createdAt.toISOString() } : null,
    shareToken,
    source,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "duplicate") {
    const shareToken = formData.get("shareToken") as string;
    if (!shareToken || !user.organization) {
      return Response.json({ error: "Missing share token or organization" }, { status: 400 });
    }

    const shareData = await getConversationByShareToken(shareToken);
    if (!shareData || shareData.conversation.id !== params.id) {
      return Response.json({ error: "Invalid share link" }, { status: 403 });
    }

    const userInOrg = await isUserInOrg(user.id, shareData.organizationId);
    if (!userInOrg) {
      return Response.json({ error: "Not in same organization" }, { status: 403 });
    }

    if (shareData.conversation.userId === user.id) {
      return Response.json({ error: "Cannot fork your own conversation" }, { status: 400 });
    }

    const newId = await duplicateConversation(params.id!, user.id);

    await logAuditEvent(user.organization.id, user.id, "forked conversation", {
      sourceConversationId: params.id,
      newConversationId: newId,
    });

    return Response.json({ conversationId: newId });
  }

  const conversation = await getConversation(params.id!);
  if (!conversation || conversation.userId !== user.id) {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }

  if (intent === "create-share") {
    const token = await createShareLink(params.id!);
    if (user.organization) {
      await logAuditEvent(user.organization.id, user.id, "shared conversation", { conversationId: params.id });
    }
    return Response.json({ shareToken: token });
  }

  if (intent === "revoke-share") {
    await revokeShareLink(params.id!);
    if (user.organization) {
      await logAuditEvent(user.organization.id, user.id, "revoked conversation share", { conversationId: params.id });
    }
    return Response.json({ shareRevoked: true });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}

export default function Conversation({ loaderData }: Route.ComponentProps) {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    conversations,
    user,
    hasMore,
    impersonating,
    orgMembers,
    isOwner,
    isAdmin,
    availableModels,
    defaultModel,
    userPreferredModel,
    hasStorageConfig,
    projects,
    activeProject,
    saasMode,
  } = useOutletContext<AppContext>();
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const initialPrompt = searchParams.get("prompt");
  const initialBlobIds = searchParams.get("blobIds") || undefined;
  const hasProcessedInitialPrompt = useRef(false);

  const { items, blobsByItemId, isSharedView, ownsConversation, sharedByName, shareLink, shareToken, source } = loaderData;
  const isReadOnly = !!impersonating || isSharedView;
  const fetcher = useFetcher<{ conversationId?: string }>();
  const navigate = useNavigate();
  const isForkPending = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.conversationId) {
      navigate(`/c/${fetcher.data.conversationId}`);
    }
  }, [fetcher.data, navigate]);

  const handlePromptProcessed = () => {
    if ((initialPrompt || initialBlobIds) && !hasProcessedInitialPrompt.current) {
      hasProcessedInitialPrompt.current = true;
      const newParams = new URLSearchParams();
      if (impersonating) {
        newParams.set("impersonate", impersonating.id);
      }
      setSearchParams(newParams, { replace: true });
    }
  };

  const handleFork = () => {
    if (!shareToken) return;
    fetcher.submit(
      { intent: "duplicate", shareToken },
      { method: "post" }
    );
  };

  const headerRight = (
    <>
      {isSharedView && (
        <>
          <span className="text-xs text-neutral-500 dark:text-neutral-400 mr-2">
            Shared by {sharedByName}
          </span>
          {!ownsConversation && (
            <button
              onClick={handleFork}
              disabled={isForkPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
              {isForkPending ? "Forking..." : "Fork"}
            </button>
          )}
        </>
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
      availableModels={availableModels}
      defaultModel={defaultModel}
      userPreferredModel={userPreferredModel}
      projects={projects}
      activeProject={activeProject}
      saasMode={saasMode}
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
              ownsConversation={ownsConversation}
              onFork={isSharedView && !ownsConversation ? handleFork : undefined}
              source={source}
              initialBlobsByItemId={blobsByItemId}
              initialBlobIds={isReadOnly ? undefined : initialBlobIds}
              hasStorageConfig={hasStorageConfig}
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
