import { redirect, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/onboarding.repos";
import { useState, useEffect } from "react";
import { requireActiveAuth } from "~/lib/auth.server";
import { getInstallation, getOrRefreshAccessToken, listInstallationRepos, type GitHubRepo } from "~/lib/github.server";
import { db } from "~/lib/db/index.server";
import { repositories, organizations } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { cloneRepository } from "~/lib/clone.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization) {
    return redirect("/");
  }

  if (user.membership?.role !== "owner") {
    return redirect("/");
  }

  if (user.organization.onboardingCompleted) {
    return redirect("/");
  }

  const installation = await getInstallation(user.organization.id);
  if (!installation) {
    return redirect("/onboarding/github");
  }

  const accessToken = await getOrRefreshAccessToken(user.organization.id);
  if (!accessToken) {
    return redirect("/onboarding/github");
  }

  const repos = await listInstallationRepos(accessToken);

  return { repos, organizationId: user.organization.id };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization || user.membership?.role !== "owner") {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const selectedRepos = formData.getAll("repos") as string[];

  if (selectedRepos.length === 0) {
    return { error: "Please select at least one repository" };
  }

  const reposData: GitHubRepo[] = JSON.parse(formData.get("reposData") as string);
  const selectedRepoData = reposData.filter((r) => selectedRepos.includes(r.id.toString()));

  for (const repo of selectedRepoData) {
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

    cloneRepository(user.organization.id, repoId, repo.name, repo.cloneUrl).catch(console.error);
  }

  await db
    .update(organizations)
    .set({ onboardingCompleted: true })
    .where(eq(organizations.id, user.organization.id));

  return redirect("/onboarding/syncing");
}

export default function OnboardingRepos({ loaderData }: Route.ComponentProps) {
  const { repos, organizationId } = loaderData;
  const fetcher = useFetcher();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const isSubmitting = fetcher.state !== "idle";
  const error = fetcher.data?.error;

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
            Select Repositories
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Choose which repositories the assistant can access.
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <fetcher.Form method="post">
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

          <p className="mt-4 text-center text-sm text-neutral-400 dark:text-neutral-500">
            Repositories will be cloned to the server for the assistant to access.
          </p>
        </fetcher.Form>
      </div>
    </div>
  );
}
