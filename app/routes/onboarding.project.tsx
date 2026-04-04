import { redirect, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/onboarding.project";
import { useState } from "react";
import { requireActiveAuth } from "~/lib/auth.server";
import { getAIProviderConfig } from "~/lib/ai-provider.server";
import {
  getInstallation,
  getOrRefreshAccessToken,
  listInstallationRepos,
  type GitHubRepo,
} from "~/lib/github.server";
import { db } from "~/lib/db/index.server";
import {
  repositories,
  organizations,
  projects,
  projectRepositories,
} from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { cloneRepository } from "~/lib/clone.server";
import { addRepoToProject } from "~/lib/projects.server";
import { isSaas } from "~/lib/appMode.server";
import { getOrCreateSandbox } from "~/lib/e2b/sandbox-manager.server";

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

  if (!isSaas()) {
    const aiConfig = await getAIProviderConfig(user.organization.id);
    if (!aiConfig) {
      return redirect("/onboarding/ai-provider");
    }
  }

  const installation = await getInstallation(user.organization.id);
  let availableRepos: GitHubRepo[] = [];

  if (installation?.status === "active") {
    const accessToken = await getOrRefreshAccessToken(user.organization.id);
    if (accessToken) {
      availableRepos = await listInstallationRepos(accessToken);
    }
  }

  const existingRepos = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      fullName: repositories.fullName,
    })
    .from(repositories)
    .where(eq(repositories.organizationId, user.organization.id));

  return {
    availableRepos,
    existingRepos,
    hasInstallation: !!installation,
    organizationId: user.organization.id,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization || user.membership?.role !== "owner") {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const projectName = (formData.get("projectName") as string)?.trim();
  const selectedRepos = formData.getAll("repos") as string[];
  const reposData = formData.get("reposData") as string;
  const existingRepoIds = formData.getAll("existingRepoIds") as string[];

  if (!projectName) {
    return { error: "Project name is required" };
  }

  if (selectedRepos.length === 0 && existingRepoIds.length === 0) {
    return { error: "Please select at least one repository" };
  }

  const projectId = crypto.randomUUID();
  await db.insert(projects).values({
    id: projectId,
    organizationId: user.organization.id,
    name: projectName,
  });

  if (reposData && selectedRepos.length > 0) {
    const allRepos: GitHubRepo[] = JSON.parse(reposData);
    const selectedRepoData = allRepos.filter((r) =>
      selectedRepos.includes(r.id.toString())
    );

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

      await addRepoToProject(projectId, repoId, user.organization.id);
      if (!isSaas()) {
        cloneRepository(
          user.organization.id,
          repoId,
          repo.name,
          repo.cloneUrl
        ).catch(console.error);
      }
    }
  }

  for (const repoId of existingRepoIds) {
    await addRepoToProject(projectId, repoId, user.organization.id);
  }

  await db
    .update(organizations)
    .set({ onboardingCompleted: true })
    .where(eq(organizations.id, user.organization.id));

  if (isSaas()) {
    getOrCreateSandbox(projectId, user.organization.id).catch((err) =>
      console.error("[onboarding] Background sandbox provision failed:", err)
    );
    return redirect("/");
  }

  return redirect("/onboarding/syncing");
}

export default function OnboardingProject({ loaderData }: Route.ComponentProps) {
  const { availableRepos, existingRepos, hasInstallation } = loaderData;
  const fetcher = useFetcher();
  const totalRepos = availableRepos.length + existingRepos.length;
  const defaultName = totalRepos === 1
    ? (availableRepos[0]?.name ?? existingRepos[0]?.name ?? "Default")
    : "Default";
  const [projectName, setProjectName] = useState(defaultName);
  const [selectedNewRepos, setSelectedNewRepos] = useState<Set<number>>(new Set());
  const [selectedExistingRepos, setSelectedExistingRepos] = useState<Set<string>>(
    new Set(existingRepos.map((r: { id: string }) => r.id))
  );

  const isSubmitting = fetcher.state !== "idle";
  const error = fetcher.data?.error;

  function toggleNewRepo(id: number) {
    setSelectedNewRepos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleExistingRepo(id: string) {
    setSelectedExistingRepos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAllNew() {
    setSelectedNewRepos(new Set(availableRepos.map((r: GitHubRepo) => r.id)));
  }

  function clearAllNew() {
    setSelectedNewRepos(new Set());
  }

  const totalSelected = selectedNewRepos.size + selectedExistingRepos.size;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-neutral-600 dark:text-neutral-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Create Your First Project
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Projects group repositories and conversations together.
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <fetcher.Form method="post">
          <input
            type="hidden"
            name="reposData"
            value={JSON.stringify(availableRepos)}
          />

          <div className="mb-6">
            <label
              htmlFor="projectName"
              className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
            >
              Project Name
            </label>
            <input
              type="text"
              id="projectName"
              name="projectName"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
              autoFocus
              className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            />
          </div>

          {existingRepos.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                Public Repositories
              </p>
              <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden">
                <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
                  {existingRepos.map((repo: { id: string; name: string; fullName: string }) => (
                    <label
                      key={repo.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        name="existingRepoIds"
                        value={repo.id}
                        checked={selectedExistingRepos.has(repo.id)}
                        onChange={() => toggleExistingRepo(repo.id)}
                        className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600"
                      />
                      <span className="text-neutral-900 dark:text-neutral-100 truncate">
                        {repo.fullName}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {hasInstallation && availableRepos.length > 0 && (
            <div className="mb-6">
              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                GitHub Repositories
              </p>
              <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">
                    {selectedNewRepos.size} of {availableRepos.length} selected
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={selectAllNew}
                      className="text-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100"
                    >
                      Select all
                    </button>
                    <span className="text-neutral-300 dark:text-neutral-600">|</span>
                    <button
                      type="button"
                      onClick={clearAllNew}
                      className="text-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="max-h-64 overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-700">
                  {availableRepos.map((repo: GitHubRepo) => (
                    <label
                      key={repo.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        name="repos"
                        value={repo.id}
                        checked={selectedNewRepos.has(repo.id)}
                        onChange={() => toggleNewRepo(repo.id)}
                        className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600"
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
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || totalSelected === 0 || !projectName.trim()}
            className="w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-4 py-3 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? "Setting up..."
              : `Create project with ${totalSelected} ${totalSelected === 1 ? "repository" : "repositories"}`}
          </button>

          <p className="mt-4 text-center text-sm text-neutral-400 dark:text-neutral-500">
            You can add more projects and repositories later in settings.
          </p>
        </fetcher.Form>
      </div>
    </div>
  );
}
