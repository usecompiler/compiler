import { Form, Link, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/settings";
import {
  requireActiveAuth,
  updateUserName,
  updateUserPassword,
} from "~/lib/auth.server";
import { canManageOrganization } from "~/lib/permissions.server";
import { getDefaultOrgSSOConfig } from "~/lib/saml.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const canManageOrg = canManageOrganization(user.membership?.role);
  const ssoConfig = await getDefaultOrgSSOConfig();
  const passwordLoginEnabled = ssoConfig?.allowPasswordLogin ?? true;
  return { user, canManageOrg, passwordLoginEnabled };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update-name") {
    const name = formData.get("name") as string;
    if (!name || name.trim().length === 0) {
      return { error: "Name is required", success: null };
    }
    await updateUserName(user.id, name.trim());
    return { error: null, success: "Name updated successfully" };
  }

  if (intent === "update-password") {
    const currentPassword = formData.get("currentPassword") as string;
    const newPassword = formData.get("newPassword") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return { error: "All password fields are required", success: null };
    }

    if (newPassword.length < 8) {
      return { error: "New password must be at least 8 characters", success: null };
    }

    if (newPassword !== confirmPassword) {
      return { error: "New passwords do not match", success: null };
    }

    const updated = await updateUserPassword(user.id, currentPassword, newPassword);
    if (!updated) {
      return { error: "Current password is incorrect", success: null };
    }

    return { error: null, success: "Password updated successfully" };
  }

  return { error: "Unknown action", success: null };
}

export default function Settings() {
  const { user, canManageOrg, passwordLoginEnabled } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

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
          <h1 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Settings</h1>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4">
          <nav className="flex gap-6">
            <span className="py-3 text-sm text-neutral-900 dark:text-neutral-100 font-medium border-b-2 border-neutral-900 dark:border-neutral-100">
              Account
            </span>
            {canManageOrg && (
              <>
                <Link
                  to="/settings/authentication"
                  className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
                >
                  Authentication
                </Link>
                <Link
                  to="/settings/organization"
                  className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
                >
                  Organization
                </Link>
                <Link
                  to="/settings/repositories"
                  className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
                >
                  Repositories
                </Link>
              </>
            )}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {actionData?.error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {actionData.error}
          </div>
        )}
        {actionData?.success && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 text-sm text-green-600 dark:text-green-400">
            {actionData.success}
          </div>
        )}

        {/* Profile Section */}
        <section>
          <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
            Profile
          </h2>

          <Form method="post" className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6 space-y-4">
            <input type="hidden" name="intent" value="update-name" />

            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
              >
                Name
              </label>
              <input
                type="text"
                id="name"
                name="name"
                defaultValue={user.name}
                required
                className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
              />
            </div>

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
              >
                Email
              </label>
              <input
                type="email"
                id="email"
                value={user.email}
                disabled
                className="w-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-500 dark:text-neutral-400 cursor-not-allowed"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="px-4 py-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </Form>
        </section>

        {passwordLoginEnabled && (
          <section>
            <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
              Change Password
            </h2>

            <Form method="post" className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6 space-y-4">
              <input type="hidden" name="intent" value="update-password" />

              <div>
                <label
                  htmlFor="currentPassword"
                  className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
                >
                  Current Password
                </label>
                <input
                  type="password"
                  id="currentPassword"
                  name="currentPassword"
                  required
                  autoComplete="current-password"
                  className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                />
              </div>

              <div>
                <label
                  htmlFor="newPassword"
                  className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
                >
                  New Password
                </label>
                <input
                  type="password"
                  id="newPassword"
                  name="newPassword"
                  required
                  autoComplete="new-password"
                  minLength={8}
                  className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                />
                <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                  Must be at least 8 characters
                </p>
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
                >
                  Confirm New Password
                </label>
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  required
                  autoComplete="new-password"
                  minLength={8}
                  className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
                >
                  Update Password
                </button>
              </div>
            </Form>
          </section>
        )}
      </main>
    </div>
  );
}
