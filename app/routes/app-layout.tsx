import { Outlet } from "react-router";
import type { Route } from "./+types/app-layout";
import { requireAuth } from "~/lib/auth.server";
import { getConversations, type ConversationMeta, type Item } from "~/lib/conversations.server";

export type { Item, ConversationMeta };

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAuth(request);
  const { conversations, hasMore } = await getConversations(user.id);
  return { user, conversations, hasMore };
}

export interface AppContext {
  user: { id: string; email: string; name: string };
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
