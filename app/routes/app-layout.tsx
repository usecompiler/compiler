import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/app-layout";
import { requireActiveAuth, type Organization, type Membership } from "~/lib/auth.server";
import { getConversations, isUserInOrg, getReviewRequestsForUser, type ConversationMeta, type Item, type ReviewRequest } from "~/lib/conversations.server";
import { getMembers, type Member } from "~/lib/invitations.server";
import { canManageOrganization, canImpersonate } from "~/lib/permissions.server";
import { getModelConfig, getUserPreferredModel, getDisplayName } from "~/lib/models.server";

function getModelDisplayName(id: string): string {
  return getDisplayName(id);
}

export type { Item, ConversationMeta, Organization, Membership, Member, ReviewRequest };

export interface ImpersonatingUser {
  id: string;
  name: string;
  email: string;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const isOwner = user.membership?.role === "owner";
  const isAdmin = user.membership?.role === "admin";
  const canManageOrg = canManageOrganization(user.membership?.role);

  if (user.organization && !user.organization.onboardingCompleted && isOwner) {
    throw redirect("/onboarding/github");
  }

  const url = new URL(request.url);
  const impersonateUserId = url.searchParams.get("impersonate");

  let impersonating: ImpersonatingUser | null = null;
  let orgMembers: Member[] = [];
  let reviewers: Member[] = [];
  let conversations: ConversationMeta[] = [];
  let reviewRequests: ReviewRequest[] = [];
  let hasMore = false;
  let availableModels: { id: string; displayName: string }[] = [];
  let defaultModel = "claude-sonnet-4-20250514";
  let userPreferredModel: string | null = null;

  if (user.organization) {
    const allMembers = await getMembers(user.organization.id);
    reviewers = allMembers.filter((m) => !m.isDeactivated);

    if (canManageOrg) {
      orgMembers = allMembers;
    }

    reviewRequests = await getReviewRequestsForUser(user.id);

    const modelConfig = await getModelConfig(user.organization.id);
    if (modelConfig) {
      defaultModel = modelConfig.defaultModel;
      availableModels = modelConfig.availableModels.map((id) => ({
        id,
        displayName: getModelDisplayName(id),
      }));

      if (user.membership) {
        const preferred = await getUserPreferredModel(user.membership.id);
        if (preferred && modelConfig.availableModels.includes(preferred)) {
          userPreferredModel = preferred;
        }
      }
    }
  }

  if (impersonateUserId && canManageOrg && user.organization) {
    const isInOrg = await isUserInOrg(impersonateUserId, user.organization.id);
    if (isInOrg) {
      const targetMember = orgMembers.find((m) => m.userId === impersonateUserId);
      if (targetMember && canImpersonate(user.membership?.role, targetMember.role)) {
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

  return {
    user,
    conversations,
    hasMore,
    impersonating,
    orgMembers,
    reviewers,
    isOwner,
    isAdmin,
    reviewRequests,
    availableModels,
    defaultModel,
    userPreferredModel,
  };
}

export interface ModelOption {
  id: string;
  displayName: string;
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
  isAdmin: boolean;
  reviewRequests: ReviewRequest[];
  availableModels: ModelOption[];
  defaultModel: string;
  userPreferredModel: string | null;
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
    isAdmin: loaderData.isAdmin,
    reviewRequests: loaderData.reviewRequests,
    availableModels: loaderData.availableModels,
    defaultModel: loaderData.defaultModel,
    userPreferredModel: loaderData.userPreferredModel,
  };

  return <Outlet context={context} />;
}
