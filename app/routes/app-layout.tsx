import { Outlet } from "react-router";
import type { Route } from "./+types/app-layout";
import { requireActiveAuth, type Organization, type Membership } from "~/lib/auth.server";
import { getConversations, type ConversationMeta, type Item } from "~/lib/conversations.server";

export type { Item, ConversationMeta, Organization, Membership };

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const { conversations, hasMore } = await getConversations(user.id);
  return { user, conversations, hasMore };
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
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const context: AppContext = {
    user: loaderData.user,
    conversations: loaderData.conversations,
    hasMore: loaderData.hasMore,
  };

  return <Outlet context={context} />;
}
