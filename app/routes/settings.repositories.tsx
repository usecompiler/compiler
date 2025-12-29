import type { Route } from "./+types/settings.repositories";
import { Await, Link, redirect, useFetcher, useSearchParams, useRevalidator } from "react-router";
import { Suspense, useState, useEffect } from "react";
import { requireActiveAuth } from "~/lib/auth.server";
import { db } from "~/lib/db/index.server";
import { repositories } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { deleteRepository, cloneRepository } from "~/lib/clone.server";
import {
  getInstallation,
  getOrRefreshAccessToken,
  listInstallationRepos,
  getGitHubAppConfigureUrl,
  getGitHubAppInstallUrl,
  type GitHubRepo,
} from "~/lib/github.server";
import { canManageOrganization } from "~/lib/permissions.server";

interface Repo {
  id: string;
  name: string;
  fullName: string;
  githubRepoId: string | null;
  isPrivate: boolean;
  cloneStatus: string;
  clonedAt: Date | null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!canManageOrganization(user.membership?.role)) {
    throw redirect("/settings");
  }

  if (!user.organization) {
    return {
      repos: [],
      availableReposPromise: Promise.resolve([]) as Promise<GitHubRepo[]>,
      hasGitHubConnection: false,
      githubConfigureUrl: null,
      githubInstallUrl: null,
    };
  }

  const [repos, installation] = await Promise.all([
    db
      .select()
      .from(repositories)
      .where(eq(repositories.organizationId, user.organization.id))
      .orderBy(repositories.name),
    getInstallation(user.organization.id),
  ]);
  let githubConfigureUrl: string | null = null;
  let availableReposPromise: Promise<GitHubRepo[]>;

  if (installation) {
    githubConfigureUrl = getGitHubAppConfigureUrl();
    const existingGithubIds = new Set(repos.map((r) => r.githubRepoId));
    const orgId = user.organization.id;

    availableReposPromise = (async () => {
      const accessToken = await getOrRefreshAccessToken(orgId);
      if (!accessToken) return [];
      const allGitHubRepos = await listInstallationRepos(accessToken);
      return allGitHubRepos.filter(
        (r) => !existingGithubIds.has(r.id.toString())
      );
    })();
  } else {
    availableReposPromise = Promise.resolve([]);
  }

  return {
    repos: repos.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.fullName,
      githubRepoId: r.githubRepoId,
      isPrivate: r.isPrivate,
      cloneStatus: r.cloneStatus,
      clonedAt: r.clonedAt,
    })),
    availableReposPromise,
    hasGitHubConnection: !!installation,
    githubConfigureUrl,
    githubInstallUrl: installation ? null : getGitHubAppInstallUrl(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization || !canManageOrganization(user.membership?.role)) {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "remove") {
    const repoId = formData.get("repoId") as string;
    const repoName = formData.get("repoName") as string;

    await deleteRepository(user.organization.id, repoId, repoName);
    return { success: true };
  }

  if (intent === "add") {
    const reposData: GitHubRepo[] = JSON.parse(
      formData.get("reposData") as string
    );
    const selectedIds = formData.getAll("selectedRepos") as string[];

    const selectedRepos = reposData.filter((r) =>
      selectedIds.includes(r.id.toString())
    );

    for (const repo of selectedRepos) {
      const repoId = crypto.randomUUID();
      await db.insert(repositories).values({
        id: repoId,
        organizationId: user.organization.id,
        githubRepoId: repo.id.toString(),
        name: repo.name,
        fullName: repo.fullName,
        cloneUrl: repo.cloneUrl,
        isPrivate: repo.private,
        cloneStatus: "pending",
      });

      cloneRepository(
        user.organization.id,
        repoId,
        repo.name,
        repo.cloneUrl
      ).catch(console.error);
    }

    return { success: true };
  }

  return { error: "Invalid action" };
}

function CloneStatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500">
        <span className="w-1.5 h-1.5 rounded-full bg-green-600 dark:bg-green-500" />
        Cloned
      </span>
    );
  }
  if (status === "cloning") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-500">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-500 animate-pulse" />
        Cloning
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-500">
        <span className="w-1.5 h-1.5 rounded-full bg-red-600 dark:bg-red-500" />
        Failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
      <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" />
      Pending
    </span>
  );
}

export default function RepositoriesSettings({
  loaderData,
}: Route.ComponentProps) {
  const { repos, availableReposPromise, hasGitHubConnection, githubConfigureUrl, githubInstallUrl } =
    loaderData;
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [searchParams] = useSearchParams();
  const [showAddRepos, setShowAddRepos] = useState(
    hasGitHubConnection && searchParams.get("showAdd") === "true"
  );
  const [selectedRepos, setSelectedRepos] = useState<Set<number>>(new Set());

  const isSubmitting = fetcher.state !== "idle";
  const hasInProgressClones = repos.some(
    (r: Repo) => r.cloneStatus === "pending" || r.cloneStatus === "cloning"
  );

  useEffect(() => {
    if (!hasInProgressClones) return;

    const interval = setInterval(() => {
      revalidator.revalidate();
    }, 2000);

    return () => clearInterval(interval);
  }, [hasInProgressClones, revalidator]);

  function toggleRepo(id: number) {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleAddSubmit() {
    setShowAddRepos(false);
    setSelectedRepos(new Set());
  }

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
            <span className="py-3 text-sm text-neutral-900 dark:text-neutral-100 font-medium border-b-2 border-neutral-900 dark:border-neutral-100">
              Repositories
            </span>
            <Link
              to="/settings/organization"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Organization
            </Link>
          </nav>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
              Connected Repositories
            </h2>
            {hasGitHubConnection && (
              <button
                type="button"
                onClick={() => setShowAddRepos(!showAddRepos)}
                className="text-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                {showAddRepos ? "Cancel" : "Add repositories"}
              </button>
            )}
          </div>

          {showAddRepos && (
            <div className="mb-6 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50">
                <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  Available Repositories
                </span>
              </div>
              <Suspense
                fallback={
                  <div className="px-4 py-8 flex items-center justify-center">
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
                      Loading available repositories...
                    </span>
                  </div>
                }
              >
                <Await resolve={availableReposPromise}>
                  {(availableRepos) =>
                    availableRepos.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                        All available repositories have been added.
                      </div>
                    ) : (
                      <fetcher.Form method="post" onSubmit={handleAddSubmit}>
                        <input type="hidden" name="intent" value="add" />
                        <input
                          type="hidden"
                          name="reposData"
                          value={JSON.stringify(availableRepos)}
                        />
                        <div className="max-h-64 overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-700">
                          {availableRepos.map((repo: GitHubRepo) => (
                            <label
                              key={repo.id}
                              className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                name="selectedRepos"
                                value={repo.id}
                                checked={selectedRepos.has(repo.id)}
                                onChange={() => toggleRepo(repo.id)}
                                className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600"
                              />
                              <span className="text-neutral-900 dark:text-neutral-100 truncate">
                                {repo.fullName}
                              </span>
                              {repo.private && (
                                <span className="flex-shrink-0 px-1.5 py-0.5 text-xs bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 rounded">
                                  Private
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                        <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50">
                          <button
                            type="submit"
                            disabled={selectedRepos.size === 0 || isSubmitting}
                            className="px-4 py-2 text-sm font-medium bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSubmitting
                              ? "Adding..."
                              : `Add ${selectedRepos.size} ${selectedRepos.size === 1 ? "repository" : "repositories"}`}
                          </button>
                        </div>
                      </fetcher.Form>
                    )
                  }
                </Await>
              </Suspense>
            </div>
          )}

          {repos.length === 0 ? (
            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6 text-center">
              <p className="text-neutral-500 dark:text-neutral-400">
                No repositories connected
              </p>
              {hasGitHubConnection && (
                <button
                  type="button"
                  onClick={() => setShowAddRepos(true)}
                  className="mt-3 text-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 underline"
                >
                  Add your first repository
                </button>
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg divide-y divide-neutral-200 dark:divide-neutral-700">
              {repos.map((repo: Repo) => (
                <div
                  key={repo.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <svg
                      className="w-5 h-5 flex-shrink-0 text-neutral-400 dark:text-neutral-500"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-neutral-900 dark:text-neutral-100 truncate">
                          {repo.fullName}
                        </span>
                        {repo.isPrivate && (
                          <span className="flex-shrink-0 px-1.5 py-0.5 text-xs bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 rounded">
                            Private
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <CloneStatusBadge status={repo.cloneStatus} />
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="repoId" value={repo.id} />
                      <input type="hidden" name="repoName" value={repo.name} />
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="p-1 text-neutral-400 hover:text-red-500 dark:text-neutral-500 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                        title="Remove repository"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.5}
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18 18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </fetcher.Form>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-4">
            The assistant can explore all synced repositories.
          </p>

          {githubConfigureUrl && (
            <div className="mt-6 pt-6 border-t border-neutral-200 dark:border-neutral-800">
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-2">
                Need to grant access to more repositories?
              </p>
              <a
                href={githubConfigureUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                Configure GitHub App access
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

          {githubInstallUrl && (
            <div className="mt-6 pt-6 border-t border-neutral-200 dark:border-neutral-800">
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-2">
                Want to add your own repositories?
              </p>
              <a
                href={githubInstallUrl}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                Connect GitHub
              </a>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
