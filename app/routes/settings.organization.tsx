import { useState } from "react";
import { Form, Link, redirect, useLoaderData, useActionData, useFetcher } from "react-router";
import type { Route } from "./+types/settings.organization";
import { requireActiveAuth } from "~/lib/auth.server";
import {
  getMembers,
  getInvitations,
  createInvitation,
  revokeInvitation,
  deactivateMember,
  reactivateMember,
  type Member,
  type Invitation,
} from "~/lib/invitations.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  // Only owners can access organization settings
  if (user.membership?.role !== "owner") {
    throw redirect("/settings");
  }

  if (!user.organization || !user.membership) {
    return { members: [], invitations: [], error: "No organization found" };
  }

  const members = await getMembers(user.organization.id);
  const invitations = await getInvitations(user.organization.id);

  return { members, invitations, error: null };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization || !user.membership) {
    return { error: "No organization found", newInviteToken: null, newInviteRole: null };
  }

  if (user.membership.role !== "owner") {
    return { error: "Only owners can manage invitations", newInviteToken: null, newInviteRole: null };
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create-invitation") {
    const invitation = await createInvitation(user.organization.id);
    return { error: null, newInviteToken: invitation.token, newInviteRole: "member" };
  }

  if (intent === "revoke-invitation") {
    const invitationId = formData.get("invitationId") as string;
    await revokeInvitation(invitationId, user.organization.id);
    return { error: null, newInviteToken: null, newInviteRole: null };
  }

  if (intent === "deactivate-member") {
    const memberId = formData.get("memberId") as string;
    const result = await deactivateMember(memberId, user.organization.id, user.id);
    if (!result.success) {
      return { error: result.error, newInviteToken: null, newInviteRole: null };
    }
    return { error: null, newInviteToken: null, newInviteRole: null };
  }

  if (intent === "reactivate-member") {
    const memberId = formData.get("memberId") as string;
    const result = await reactivateMember(memberId, user.organization.id);
    if (!result.success) {
      return { error: result.error, newInviteToken: null, newInviteRole: null };
    }
    return { error: null, newInviteToken: null, newInviteRole: null };
  }

  return { error: "Unknown action", newInviteToken: null, newInviteRole: null };
}

export default function OrganizationSettings() {
  const { members, invitations, error: loaderError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  // Only owners can access this page, so isOwner is always true
  const isOwner = true;

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  if (loaderError) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 p-8">
        <p className="text-red-500">{loaderError}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      {/* Header */}
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/"
            className="p-2 -ml-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <h1 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Organization Settings</h1>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4">
          <nav className="flex gap-6">
            <Link
              to="/settings"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Account
            </Link>
            <Link
              to="/settings/repositories"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Repositories
            </Link>
            <span className="py-3 text-sm text-neutral-900 dark:text-neutral-100 font-medium border-b-2 border-neutral-900 dark:border-neutral-100">
              Organization
            </span>
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {actionData?.error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
            {actionData.error}
          </div>
        )}

        {/* Members Section */}
        <section>
          <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
            Members
          </h2>

          <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg divide-y divide-neutral-200 dark:divide-neutral-700">
            {members.map((member) => (
              <MemberRow key={member.id} member={member} isOwner={isOwner} />
            ))}
          </div>
        </section>

        {/* Invitations Section (Owner only) */}
        {isOwner && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                Pending Invitations
              </h2>
              <Form method="post">
                <input type="hidden" name="intent" value="create-invitation" />
                <button
                  type="submit"
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Create Invite
                </button>
              </Form>
            </div>

            {/* Show newly created invite link */}
            {actionData?.newInviteToken && (
              <div className="mb-4 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3">
                <p className="text-sm text-green-600 dark:text-green-400 mb-2">
                  Invitation created! Share this link:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-neutral-100 dark:bg-neutral-900 px-3 py-2 rounded text-sm text-neutral-700 dark:text-neutral-300 overflow-x-auto">
                    {typeof window !== "undefined" ? `${window.location.origin}/invite/${actionData.newInviteToken}` : `/invite/${actionData.newInviteToken}`}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyInviteLink(actionData.newInviteToken!)}
                    className="px-3 py-2 text-sm bg-neutral-200 dark:bg-neutral-700 rounded hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
                  >
                    {copiedToken === actionData.newInviteToken ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            )}

            {invitations.length === 0 ? (
              <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6 text-center">
                <p className="text-neutral-500 dark:text-neutral-400">No pending invitations</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg divide-y divide-neutral-200 dark:divide-neutral-700">
                {invitations.map((invitation) => (
                  <InvitationRow
                    key={invitation.id}
                    invitation={invitation}
                    onCopy={() => copyInviteLink(invitation.token)}
                    isCopied={copiedToken === invitation.token}
                  />
                ))}
              </div>
            )}

            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-4">
              Invitations expire after 24 hours and can only be used once.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

function MemberRow({ member, isOwner }: { member: Member; isOwner: boolean }) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  const initials = member.user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleDeactivate = (e: React.FormEvent) => {
    if (!window.confirm(`Deactivate ${member.user.name}? They will lose access to this organization.`)) {
      e.preventDefault();
    }
  };

  return (
    <div className={`flex items-center justify-between px-4 py-3 ${isSubmitting ? "opacity-50" : ""} ${member.isDeactivated ? "bg-neutral-50 dark:bg-neutral-900/50" : ""}`}>
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
          member.isDeactivated
            ? "bg-neutral-200 dark:bg-neutral-700 text-neutral-400 dark:text-neutral-500"
            : "bg-neutral-300 dark:bg-neutral-600 text-neutral-700 dark:text-neutral-200"
        }`}>
          {initials}
        </div>
        <div>
          <div className={`text-sm ${member.isDeactivated ? "text-neutral-400 dark:text-neutral-500" : "text-neutral-900 dark:text-neutral-100"}`}>
            {member.user.name}
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">{member.user.email}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {member.isDeactivated && (
          <span className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
            Deactivated
          </span>
        )}
        <span className={`text-xs px-2 py-1 rounded ${
          member.role === "owner"
            ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
            : "bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400"
        }`}>
          {member.role}
        </span>
        {isOwner && member.role !== "owner" && (
          member.isDeactivated ? (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="reactivate-member" />
              <input type="hidden" name="memberId" value={member.id} />
              <button
                type="submit"
                className="px-2 py-1 text-xs bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                title="Reactivate member"
              >
                Reactivate
              </button>
            </fetcher.Form>
          ) : (
            <fetcher.Form method="post" onSubmit={handleDeactivate}>
              <input type="hidden" name="intent" value="deactivate-member" />
              <input type="hidden" name="memberId" value={member.id} />
              <button
                type="submit"
                className="p-1 text-neutral-400 hover:text-red-500 transition-colors"
                title="Deactivate member"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </fetcher.Form>
          )
        )}
      </div>
    </div>
  );
}

function InvitationRow({
  invitation,
  onCopy,
  isCopied,
}: {
  invitation: Invitation;
  onCopy: () => void;
  isCopied: boolean;
}) {
  const fetcher = useFetcher();
  const isRevoking = fetcher.state !== "idle";
  const expiresAt = new Date(invitation.expiresAt);
  const now = new Date();
  const hoursLeft = Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)));

  return (
    <div className={`flex items-center justify-between px-4 py-3 ${isRevoking ? "opacity-50" : ""}`}>
      <div>
        <div className="text-sm text-neutral-900 dark:text-neutral-100">
          Invite link ({invitation.role})
        </div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          Expires in {hoursLeft} hour{hoursLeft !== 1 ? "s" : ""}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="px-3 py-1.5 text-sm bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors"
        >
          {isCopied ? "Copied!" : "Copy Link"}
        </button>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="revoke-invitation" />
          <input type="hidden" name="invitationId" value={invitation.id} />
          <button
            type="submit"
            className="p-1.5 text-neutral-400 hover:text-red-500 transition-colors"
            title="Revoke invitation"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
        </fetcher.Form>
      </div>
    </div>
  );
}
