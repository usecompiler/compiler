import { Outlet } from "react-router";
import type { Route } from "./+types/app-layout";
import { requireActiveAuth, type Organization, type Membership } from "~/lib/auth.server";
import { getConversations, isUserInOrg, getReviewRequestsForUser, type ConversationMeta, type Item, type ReviewRequest } from "~/lib/conversations.server";
import { getMembers, type Member } from "~/lib/invitations.server";

export type { Item, ConversationMeta, Organization, Membership, Member, ReviewRequest };

export interface ImpersonatingUser {
  id: string;
  name: string;
  email: string;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const isOwner = user.membership?.role === "owner";

  const url = new URL(request.url);
  const impersonateUserId = url.searchParams.get("impersonate");

  let impersonating: ImpersonatingUser | null = null;
  let orgMembers: Member[] = [];
  let reviewers: Member[] = [];
  let conversations: ConversationMeta[] = [];
  let reviewRequests: ReviewRequest[] = [];
  let hasMore = false;

  if (user.organization) {
    const allMembers = await getMembers(user.organization.id);
    reviewers = allMembers.filter((m) => !m.isDeactivated);

    if (isOwner) {
      orgMembers = allMembers;
    }

    reviewRequests = await getReviewRequestsForUser(user.id);
  }

  if (impersonateUserId && isOwner && user.organization) {
    const isInOrg = await isUserInOrg(impersonateUserId, user.organization.id);
    if (isInOrg) {
      const targetMember = orgMembers.find((m) => m.userId === impersonateUserId);
      if (targetMember) {
        impersonating = {
          id: targetMember.userId,
          name: targetMember.user.name,
          email: targetMember.user.email,
        };
        const result = await getConversations(impersonateUserId);
        conversations = result.conversations;
        hasMore = result.hasMore;
      }
    }
  }

  if (!impersonating) {
    const result = await getConversations(user.id);
    conversations = result.conversations;
    hasMore = result.hasMore;
  }

  return { user, conversations, hasMore, impersonating, orgMembers, reviewers, isOwner, reviewRequests };
}

export interface AppContext {
  user: {
    id: string;
    email: string;
    name: string;
    organization: Organization | null;
    membership: Membership | null;
  };
  conversations: ConversationMeta[];
  hasMore: boolean;
  impersonating: ImpersonatingUser | null;
  orgMembers: Member[];
  reviewers: Member[];
  isOwner: boolean;
  reviewRequests: ReviewRequest[];
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const context: AppContext = {
    user: loaderData.user,
    conversations: loaderData.conversations,
    hasMore: loaderData.hasMore,
    impersonating: loaderData.impersonating,
    orgMembers: loaderData.orgMembers,
    reviewers: loaderData.reviewers,
    isOwner: loaderData.isOwner,
    reviewRequests: loaderData.reviewRequests,
  };

  return <Outlet context={context} />;
}
