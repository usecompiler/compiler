import { Form, redirect } from "react-router";
import type { Route } from "./+types/deactivated";
import { getUser } from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);

  // Not logged in - go to login
  if (!user) {
    throw redirect("/login");
  }

  // Not deactivated - go home
  if (!user.membership?.isDeactivated) {
    throw redirect("/");
  }

  return null;
}

export default function Deactivated() {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg p-8 text-center">
        <div className="mb-6">
          <div className="mx-auto w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-red-600 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
          Access Revoked
        </h1>

        <p className="text-neutral-600 dark:text-neutral-400 mb-6">
          Your access to this organization has been revoked. If you believe this
          is a mistake, please contact your organization owner.
        </p>

        <Form method="post" action="/logout">
          <button
            type="submit"
            className="w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 py-2 px-4 rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
          >
            Sign Out
          </button>
        </Form>
      </div>
    </div>
  );
}
