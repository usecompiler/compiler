import { Outlet } from "react-router";
import type { Route } from "./+types/app-layout";
import { requireActiveAuth, type Organization, type Membership } from "~/lib/auth.server";
import { getConversations, isUserInOrg, type ConversationMeta, type Item } from "~/lib/conversations.server";
import { getMembers, type Member } from "~/lib/invitations.server";

export type { Item, ConversationMeta, Organization, Membership, Member };

export interface ImpersonatingUser {
  id: string;
  name: string;
  email: string;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const isOwner = user.membership?.role === "owner";

  // Parse impersonate query param
  const url = new URL(request.url);
  const impersonateUserId = url.searchParams.get("impersonate");

  let impersonating: ImpersonatingUser | null = null;
  let orgMembers: Member[] = [];
  let conversations: ConversationMeta[] = [];
  let hasMore = false;

  // Load org members for owners (for the dropdown)
  if (isOwner && user.organization) {
    orgMembers = await getMembers(user.organization.id);
  }

  // Handle impersonation
  if (impersonateUserId && isOwner && user.organization) {
    // Verify target user is in same org
    const isInOrg = await isUserInOrg(impersonateUserId, user.organization.id);
    if (isInOrg) {
      // Find the member being impersonated
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

  // If not impersonating, get user's own conversations
  if (!impersonating) {
    const result = await getConversations(user.id);
    conversations = result.conversations;
    hasMore = result.hasMore;
  }

  return { user, conversations, hasMore, impersonating, orgMembers, isOwner };
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
  isOwner: boolean;
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const context: AppContext = {
    user: loaderData.user,
    conversations: loaderData.conversations,
    hasMore: loaderData.hasMore,
    impersonating: loaderData.impersonating,
    orgMembers: loaderData.orgMembers,
    isOwner: loaderData.isOwner,
  };

  return <Outlet context={context} />;
}
