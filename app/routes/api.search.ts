import type { Route } from "./+types/api.search";
import { requireActiveAuth } from "~/lib/auth.server";
import { searchConversations, isUserInOrg } from "~/lib/conversations.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const limit = parseInt(url.searchParams.get("limit") || "10");
  const impersonateUserId = url.searchParams.get("impersonate");

  let targetUserId = user.id;

  if (impersonateUserId && user.membership?.role === "owner" && user.organization) {
    const isInOrg = await isUserInOrg(impersonateUserId, user.organization.id);
    if (isInOrg) {
      targetUserId = impersonateUserId;
    }
  }

  const results = await searchConversations(targetUserId, query, limit);
  return Response.json({ results });
}
