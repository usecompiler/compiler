import type { Route } from "./+types/settings.github";
import { Await, Form, Link, redirect, useActionData } from "react-router";
import { Suspense, useState, useEffect } from "react";
import { requireActiveAuth } from "~/lib/auth.server";
import {
  getInstallation,
  getOrRefreshAccessToken,
  listInstallationRepos,
  getGitHubAppConfigureUrl,
  getGitHubAppInstallUrl,
  getGitHubAppConfig,
  saveGitHubAppConfig,
  validateGitHubAppConfig,
  type GitHubRepo,
} from "~/lib/github.server";
import { canManageOrganization } from "~/lib/permissions.server";
import { logAuditEvent } from "~/lib/audit.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!canManageOrganization(user.membership?.role)) {
    throw redirect("/settings");
  }

  if (!user.organization) {
    return {
      accessibleReposPromise: Promise.resolve([]) as Promise<GitHubRepo[]>,
      hasGitHubConnection: false,
      githubConfigureUrl: null,
      githubInstallUrl: null,
      appConfig: null,
    };
  }

  const [installation, appConfig] = await Promise.all([
    getInstallation(user.organization.id),
    getGitHubAppConfig(user.organization.id),
  ]);

  let githubConfigureUrl: string | null = null;
  let githubInstallUrl: string | null = null;
  let accessibleReposPromise: Promise<GitHubRepo[]>;

  if (installation && appConfig) {
    githubConfigureUrl = await getGitHubAppConfigureUrl(user.organization.id);
    const orgId = user.organization.id;

    accessibleReposPromise = (async () => {
      const accessToken = await getOrRefreshAccessToken(orgId);
      if (!accessToken) return [];
      return listInstallationRepos(accessToken);
    })();
  } else {
    accessibleReposPromise = Promise.resolve([]);
    if (appConfig && !installation) {
      githubInstallUrl = await getGitHubAppInstallUrl(user.organization.id);
    }
  }

  return {
    accessibleReposPromise,
    hasGitHubConnection: !!installation,
    githubConfigureUrl,
    githubInstallUrl,
    appConfig: appConfig ? { appId: appConfig.appId, appSlug: appConfig.appSlug } : null,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization || !canManageOrganization(user.membership?.role)) {
    return { error: "Unauthorized", configSuccess: false };
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update-config") {
    const appId = (formData.get("appId") as string)?.trim();
    const appSlug = (formData.get("appSlug") as string)?.trim();
    const privateKey = formData.get("privateKey") as string;

    if (!appId || !appSlug || !privateKey) {
      return { error: "All fields are required", configSuccess: false };
    }

    if (!/^\d+$/.test(appId)) {
      return { error: "App ID must be a number", configSuccess: false };
    }

    if (!/^[a-z0-9-]+$/.test(appSlug)) {
      return { error: "App Slug must contain only lowercase letters, numbers, and hyphens", configSuccess: false };
    }

    const normalizedKey = privateKey.replace(/\\n/g, "\n");
    if (!normalizedKey.includes("-----BEGIN") || !normalizedKey.includes("PRIVATE KEY-----")) {
      return { error: "Private key must be in PEM format", configSuccess: false };
    }

    const validation = validateGitHubAppConfig(appId, privateKey);
    if (!validation.valid) {
      return { error: validation.error || "Invalid private key", configSuccess: false };
    }

    await saveGitHubAppConfig(user.organization.id, appId, appSlug, privateKey);
    await logAuditEvent(user.organization.id, user.id, "updated GitHub App configuration");
    return { error: null, configSuccess: true };
  }

  return { error: "Invalid action", configSuccess: false };
}

export default function GitHubSettings({
  loaderData,
}: Route.ComponentProps) {
  const { accessibleReposPromise, hasGitHubConnection, githubConfigureUrl, githubInstallUrl, appConfig } =
    loaderData;
  const actionData = useActionData<typeof action>();
  const [showEditConfig, setShowEditConfig] = useState(!appConfig);

  useEffect(() => {
    if (actionData?.configSuccess) {
      setShowEditConfig(false);
    }
  }, [actionData]);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/"
            className="p-2 -ml-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
              />
            </svg>
          </Link>
          <h1 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
            Settings
          </h1>
        </div>
      </header>

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
              to="/settings/ai-provider"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              AI Provider
            </Link>
            <Link
              to="/settings/audit-log"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Audit Log
            </Link>
            <Link
              to="/settings/authentication"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Authentication
            </Link>
            <span className="py-3 text-sm text-neutral-900 dark:text-neutral-100 font-medium border-b-2 border-neutral-900 dark:border-neutral-100">
              GitHub
            </span>
            <Link
              to="/settings/organization"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Organization
            </Link>
            <Link
              to="/settings/projects"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Projects
            </Link>
            <Link
              to="/settings/storage"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Storage
            </Link>
          </nav>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
              GitHub App Configuration
            </h2>
            {appConfig && (
              <button
                type="button"
                onClick={() => setShowEditConfig(!showEditConfig)}
                className="text-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                {showEditConfig ? "Cancel" : "Edit"}
              </button>
            )}
          </div>

          {actionData?.error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {actionData.error}
            </div>
          )}

          {actionData?.configSuccess && (
            <div className="mb-4 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 text-sm text-green-600 dark:text-green-400">
              Configuration saved successfully
            </div>
          )}

          {showEditConfig ? (
            <Form method="post" className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4 space-y-4">
              <input type="hidden" name="intent" value="update-config" />

              <div>
                <label htmlFor="appId" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  GitHub App ID
                </label>
                <input
                  type="text"
                  id="appId"
                  name="appId"
                  defaultValue={appConfig?.appId || ""}
                  required
                  className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                />
              </div>

              <div>
                <label htmlFor="appSlug" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  GitHub App Slug
                </label>
                <input
                  type="text"
                  id="appSlug"
                  name="appSlug"
                  defaultValue={appConfig?.appSlug || ""}
                  required
                  className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                />
              </div>

              <div>
                <label htmlFor="privateKey" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Private Key
                </label>
                <textarea
                  id="privateKey"
                  name="privateKey"
                  rows={4}
                  required
                  placeholder="-----BEGIN RSA PRIVATE KEY-----"
                  className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-neutral-900 dark:text-neutral-100 text-sm font-mono focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                />
                <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                  {appConfig ? "Enter new private key to update" : "Paste the entire PEM file contents"}
                </p>
              </div>

              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
              >
                {appConfig ? "Update Configuration" : "Save Configuration"}
              </button>
            </Form>
          ) : appConfig ? (
            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">App ID</span>
                  <p className="text-neutral-900 dark:text-neutral-100 font-mono">{appConfig.appId}</p>
                </div>
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">App Slug</span>
                  <p className="text-neutral-900 dark:text-neutral-100 font-mono">{appConfig.appSlug}</p>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section>
          <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
            Accessible Repositories
          </h2>

          {!hasGitHubConnection ? (
            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6 text-center">
              <p className="text-neutral-500 dark:text-neutral-400">
                No GitHub installation connected
              </p>
              {githubInstallUrl && (
                <a
                  href={githubInstallUrl}
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  Install GitHub App
                </a>
              )}
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6 flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-neutral-400 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span className="ml-2 text-sm text-neutral-500 dark:text-neutral-400">
                    Loading repositories...
                  </span>
                </div>
              }
            >
              <Await resolve={accessibleReposPromise}>
                {(repos) =>
                  repos.length === 0 ? (
                    <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6 text-center">
                      <p className="text-neutral-500 dark:text-neutral-400">
                        No repositories accessible. Configure your GitHub App to grant access to repositories.
                      </p>
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg divide-y divide-neutral-200 dark:divide-neutral-700">
                      {repos.map((repo: GitHubRepo) => (
                        <div
                          key={repo.id}
                          className="flex items-center gap-3 px-4 py-3"
                        >
                          <svg
                            className="w-5 h-5 flex-shrink-0 text-neutral-400 dark:text-neutral-500"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                          </svg>
                          <span className="text-neutral-900 dark:text-neutral-100 truncate">
                            {repo.fullName}
                          </span>
                          {repo.private && (
                            <span className="flex-shrink-0 px-1.5 py-0.5 text-xs bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 rounded">
                              Private
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                }
              </Await>
            </Suspense>
          )}

          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-4">
            These are the repositories your GitHub App has access to. Add them to projects from the{" "}
            <Link to="/settings/projects" className="underline hover:text-neutral-600 dark:hover:text-neutral-300">
              Projects
            </Link>{" "}
            settings.
          </p>

          {githubConfigureUrl && (
            <div className="mt-4">
              <a
                href={githubConfigureUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                Manage repository access on GitHub
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25"
                  />
                </svg>
              </a>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
