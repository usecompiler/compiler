import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/invite.$token";
import { getUser } from "~/lib/auth.server";
import { getInvitationByToken } from "~/lib/invitations.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const token = params.token;
  if (!token) {
    return { error: "Invalid invitation link", invitation: null, isLoggedIn: false };
  }

  const invitation = await getInvitationByToken(token);
  if (!invitation) {
    return { error: "This invitation has expired or is invalid", invitation: null, isLoggedIn: false };
  }

  const user = await getUser(request);

  return {
    error: null,
    invitation: {
      token: invitation.token,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
    },
    isLoggedIn: !!user,
  };
}

export default function InvitePage() {
  const { error, invitation, isLoggedIn } = useLoaderData<typeof loader>();

  if (error || !invitation) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Invalid Invitation
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 mb-6">
            {error}
          </p>
          <Link
            to="/login"
            className="inline-block px-4 py-2.5 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
          >
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-6">
          You've been invited!
        </h1>

        {isLoggedIn ? (
          <div className="space-y-4">
            <p className="text-neutral-500 dark:text-neutral-400">
              You're already signed in and belong to an organization.
            </p>
            <Link
              to="/"
              className="block w-full px-4 py-2.5 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
            >
              Go to Dashboard
            </Link>
          </div>
        ) : (
          <Link
            to={`/signup?invite=${invitation.token}`}
            className="block w-full px-4 py-2.5 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
          >
            Sign up to join
          </Link>
        )}

        <p className="mt-6 text-xs text-neutral-400 dark:text-neutral-500">
          This invitation expires {new Date(invitation.expiresAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
