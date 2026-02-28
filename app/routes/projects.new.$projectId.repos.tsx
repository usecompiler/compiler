import { Form, redirect, useFetcher, useLoaderData } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/projects.new.$projectId.repos";
import { requireActiveAuth } from "~/lib/auth.server";
import { getProject } from "~/lib/projects.server";
import { addRepoToProject } from "~/lib/projects.server";
import {
  getInstallation,
  getOrRefreshAccessToken,
  listInstallationRepos,
  getGitHubAppConfig,
  type GitHubRepo,
} from "~/lib/github.server";
import { db } from "~/lib/db/index.server";
import { repositories, organizations } from "~/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { cloneRepository, clonePublicRepository } from "~/lib/clone.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization) {
    return redirect("/");
  }

  const project = await getProject(params.projectId);
  if (!project || project.organizationId !== user.organization.id) {
    return redirect("/projects/new");
  }

  const isOnboarding = !user.organization.onboardingCompleted;
  const orgId = user.organization.id;

  const installation = await getInstallation(orgId);
  const appConfig = await getGitHubAppConfig(orgId);

  let installUrl: string | null = null;
  let repos: GitHubRepo[] = [];

  if (!installation && appConfig) {
    installUrl = `https://github.com/apps/${appConfig.appSlug}/installations/new?state=project:${params.projectId}`;
  }

  if (installation) {
    const accessToken = await getOrRefreshAccessToken(orgId);
    if (accessToken) {
      const allRepos = await listInstallationRepos(accessToken);
      const existingRepos = await db
        .select({ githubRepoId: repositories.githubRepoId })
        .from(repositories)
        .where(eq(repositories.organizationId, orgId));
      const existingIds = new Set(existingRepos.map((r) => r.githubRepoId));
      repos = allRepos.filter((r) => !existingIds.has(r.id.toString()));
    }
  }

  return {
    projectId: params.projectId,
    projectName: project.name,
    hasInstallation: !!installation,
    hasAppConfig: !!appConfig,
    installUrl,
    repos,
    isOnboarding,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization) {
    return redirect("/");
  }

  const project = await getProject(params.projectId);
  if (!project || project.organizationId !== user.organization.id) {
    return redirect("/projects/new");
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const orgId = user.organization.id;
  const isOnboarding = !user.organization.onboardingCompleted;

  if (intent === "add-github-repos") {
    const selectedRepos = formData.getAll("repos") as string[];
    const reposData: GitHubRepo[] = JSON.parse(formData.get("reposData") as string);
    const selectedRepoData = reposData.filter((r) => selectedRepos.includes(r.id.toString()));

    if (selectedRepoData.length === 0) {
      return { error: "Please select at least one repository" };
    }

    for (const repo of selectedRepoData) {
      const repoId = crypto.randomUUID();
      await db.insert(repositories).values({
        id: repoId,
        organizationId: orgId,
        githubRepoId: repo.id.toString(),
        name: repo.name,
        fullName: repo.fullName,
        cloneUrl: repo.cloneUrl,
        isPrivate: repo.private,
        cloneStatus: "pending",
      });
      await addRepoToProject(params.projectId, repoId);
      cloneRepository(orgId, repoId, repo.name, repo.cloneUrl).catch(console.error);
    }

    if (isOnboarding) {
      await db
        .update(organizations)
        .set({ onboardingCompleted: true })
        .where(eq(organizations.id, orgId));
    }

    return redirect(`/projects/new/${params.projectId}/syncing`);
  }

  if (intent === "add-public-repo") {
    const repoUrl = (formData.get("repoUrl") as string)?.trim();

    if (!repoUrl) {
      return { error: "Repository URL is required" };
    }

    const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/.*)?$/);
    if (!match) {
      return { error: "Invalid GitHub URL. Use a URL like https://github.com/owner/repo" };
    }

    const fullName = match[1];
    const name = fullName.split("/")[1];
    const cloneUrl = `https://github.com/${fullName}.git`;

    const existingByName = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(
        and(
          eq(repositories.organizationId, orgId),
          eq(repositories.fullName, fullName)
        )
      )
      .limit(1);

    if (existingByName.length > 0) {
      await addRepoToProject(params.projectId, existingByName[0].id);
    } else {
      const repoId = crypto.randomUUID();
      await db.insert(repositories).values({
        id: repoId,
        organizationId: orgId,
        githubRepoId: null,
        name,
        fullName,
        cloneUrl,
        isPrivate: false,
        cloneStatus: "pending",
      });
      await addRepoToProject(params.projectId, repoId);
      clonePublicRepository(orgId, repoId, name, cloneUrl).catch(console.error);
    }

    if (isOnboarding) {
      await db
        .update(organizations)
        .set({ onboardingCompleted: true })
        .where(eq(organizations.id, orgId));
    }

    return redirect(`/projects/new/${params.projectId}/syncing`);
  }

  return { error: "Invalid action" };
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

export default function ProjectRepos({ loaderData }: Route.ComponentProps) {
  const {
    projectId,
    projectName,
    hasInstallation,
    hasAppConfig,
    installUrl,
    repos,
    isOnboarding,
  } = loaderData;
  const fetcher = useFetcher();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [publicRepoUrl, setPublicRepoUrl] = useState("");

  const isSubmitting = fetcher.state !== "idle";
  const fetcherData = fetcher.data as { error?: string } | undefined;
  const error = fetcherData?.error;

  function toggleRepo(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(repos.map((r: GitHubRepo) => r.id)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Add repositories
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Connect repositories to <span className="font-medium">{projectName}</span> so the assistant can access your code.
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {hasInstallation && repos.length > 0 && (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="add-github-repos" />
            <input type="hidden" name="reposData" value={JSON.stringify(repos)} />

            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  {selected.size} of {repos.length} selected
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    Select all
                  </button>
                  <span className="text-neutral-300 dark:text-neutral-600">|</span>
                  <button
                    type="button"
                    onClick={selectNone}
                    className="text-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-700">
                {repos.map((repo: GitHubRepo) => (
                  <label
                    key={repo.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      name="repos"
                      value={repo.id}
                      checked={selected.has(repo.id)}
                      onChange={() => toggleRepo(repo.id)}
                      className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100 focus:ring-neutral-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-neutral-900 dark:text-neutral-100 truncate">
                          {repo.fullName}
                        </span>
                        {repo.private && (
                          <span className="flex-shrink-0 px-1.5 py-0.5 text-xs bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 rounded">
                            Private
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || selected.size === 0}
              className="w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-4 py-3 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Setting up..." : `Continue with ${selected.size} ${selected.size === 1 ? "repository" : "repositories"}`}
            </button>
          </fetcher.Form>
        )}

        {!hasInstallation && hasAppConfig && installUrl && (
          <>
            <a
              href={installUrl}
              className="inline-flex items-center justify-center gap-2 w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-4 py-3 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
            >
              <GitHubIcon className="w-5 h-5" />
              Connect GitHub
            </a>

            <p className="mt-4 text-center text-sm text-neutral-400 dark:text-neutral-500">
              You'll be redirected to GitHub to install the app and grant access to repositories.
            </p>
          </>
        )}

        {hasInstallation && repos.length === 0 && (
          <div className="text-center mb-6">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              All GitHub App repositories have already been added. You can add a public repository below.
            </p>
          </div>
        )}

        <div className={hasInstallation && repos.length > 0 ? "mt-6" : ""}>
          {(hasInstallation || !hasAppConfig) && (
            <>
              {hasInstallation && repos.length > 0 && (
                <div className="my-6 flex items-center gap-4">
                  <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
                  <span className="text-sm text-neutral-400 dark:text-neutral-500">or add a public repository</span>
                  <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
                </div>
              )}

              {!hasAppConfig && (
                <div className="text-center mb-6">
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
                    No GitHub App configured. You can add a public repository by URL.
                  </p>
                </div>
              )}

              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="add-public-repo" />
                <div className="flex gap-2">
                  <input
                    type="text"
                    name="repoUrl"
                    value={publicRepoUrl}
                    onChange={(e) => setPublicRepoUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="flex-1 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting || !publicRepoUrl.trim()}
                    className="px-4 py-2.5 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? "Adding..." : "Add"}
                  </button>
                </div>
                <p className="mt-2 text-sm text-neutral-400 dark:text-neutral-500">
                  Paste a GitHub URL to add any public repository.
                </p>
              </fetcher.Form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
