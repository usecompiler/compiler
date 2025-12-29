import type { Route } from "./+types/api.search";
import { requireActiveAuth } from "~/lib/auth.server";
import { searchConversations, isUserInOrg } from "~/lib/conversations.server";
import { getMembers } from "~/lib/invitations.server";
import { canManageOrganization, canImpersonate } from "~/lib/permissions.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const limit = parseInt(url.searchParams.get("limit") || "10");
  const impersonateUserId = url.searchParams.get("impersonate");

  let targetUserId = user.id;

  if (impersonateUserId && canManageOrganization(user.membership?.role) && user.organization) {
    const isInOrg = await isUserInOrg(impersonateUserId, user.organization.id);
    if (isInOrg) {
      const members = await getMembers(user.organization.id);
      const targetMember = members.find((m) => m.userId === impersonateUserId);
      if (targetMember && canImpersonate(user.membership?.role, targetMember.role)) {
        targetUserId = impersonateUserId;
      }
    }
  }

  const results = await searchConversations(targetUserId, query, limit);
  return Response.json({ results });
}
