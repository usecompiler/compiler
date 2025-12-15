import { redirect } from "react-router";
import { Link } from "react-router";
import type { Route } from "./+types/share.$token";
import { getConversationByShareToken } from "~/lib/conversations.server";
import { requireActiveAuth } from "~/lib/auth.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const token = params.token;
  if (!token) {
    return { error: "Invalid share link" };
  }

  // Validate the share token
  const shareData = await getConversationByShareToken(token);
  if (!shareData) {
    return { error: "This share link is invalid or has been revoked" };
  }

  // Check if user is authenticated
  try {
    await requireActiveAuth(request);
  } catch {
    // Not authenticated - show login prompt
    return { error: "Please log in to view this shared conversation", needsAuth: true };
  }

  // Redirect to conversation with share token
  throw redirect(`/c/${shareData.conversation.id}?share=${token}`);
}

export default function SharePage({ loaderData }: Route.ComponentProps) {
  const { error, needsAuth } = loaderData as { error?: string; needsAuth?: boolean };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
          {needsAuth ? "Authentication Required" : "Invalid Link"}
        </h1>
        <p className="text-neutral-500 dark:text-neutral-400 mb-6">
          {error}
        </p>
        <Link
          to={needsAuth ? "/login" : "/"}
          className="inline-block px-4 py-2.5 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
        >
          {needsAuth ? "Log in" : "Go Home"}
        </Link>
      </div>
    </div>
  );
}
