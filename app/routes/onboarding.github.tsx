import { redirect, useFetcher } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/onboarding.github";
import { requireActiveAuth } from "~/lib/auth.server";
import { getInstallation, getGitHubAppConfig } from "~/lib/github.server";
import { db } from "~/lib/db/index.server";
import { repositories, organizations } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { clonePublicRepository } from "~/lib/clone.server";

const PUBLIC_REPOS = [
  { fullName: "basecamp/fizzy", name: "fizzy", cloneUrl: "https://github.com/basecamp/fizzy.git" },
  { fullName: "WordPress/WordPress", name: "WordPress", cloneUrl: "https://github.com/WordPress/WordPress.git" },
  { fullName: "signalapp/Signal-iOS", name: "Signal-iOS", cloneUrl: "https://github.com/signalapp/Signal-iOS.git" },
];

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

  const appConfig = await getGitHubAppConfig(user.organization.id);
  if (!appConfig) {
    return redirect("/onboarding/github-app");
  }

  const installation = await getInstallation(user.organization.id);
  if (installation) {
    return redirect("/onboarding/repos");
  }

  return { appSlug: appConfig.appSlug, orgId: user.organization.id };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization || user.membership?.role !== "owner") {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const selectedRepo = formData.get("repos") as string;

  if (!selectedRepo) {
    return { error: "Please select a repository" };
  }

  const repo = PUBLIC_REPOS.find((r) => r.fullName === selectedRepo);
  if (!repo) {
    return { error: "Invalid repository selected" };
  }

  const repoId = crypto.randomUUID();
  await db.insert(repositories).values({
    id: repoId,
    organizationId: user.organization.id,
    githubRepoId: null,
    name: repo.name,
    fullName: repo.fullName,
    cloneUrl: repo.cloneUrl,
    isPrivate: false,
    cloneStatus: "pending",
  });

  clonePublicRepository(user.organization.id, repoId, repo.name, repo.cloneUrl).catch(
    console.error
  );

  await db
    .update(organizations)
    .set({ onboardingCompleted: true })
    .where(eq(organizations.id, user.organization.id));

  return redirect("/onboarding/syncing");
}

export default function OnboardingGithub({ loaderData }: Route.ComponentProps) {
  const { appSlug, orgId } = loaderData;
  const installUrl = `https://github.com/apps/${appSlug}/installations/new?state=${orgId}`;
  const fetcher = useFetcher();
  const [selected, setSelected] = useState<string | null>(null);

  const isSubmitting = fetcher.state !== "idle";
  const error = fetcher.data?.error;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-neutral-600 dark:text-neutral-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Connect to GitHub
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Connect your repositories so the assistant can explain how your product works.
          </p>
        </div>

        <a
          href={installUrl}
          className="inline-flex items-center justify-center gap-2 w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-4 py-3 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          Install GitHub App
        </a>

        <p className="mt-4 text-center text-sm text-neutral-400 dark:text-neutral-500">
          You'll be redirected to GitHub to authorize the app.
        </p>

        <div className="my-8 flex items-center gap-4">
          <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
          <span className="text-sm text-neutral-400 dark:text-neutral-500">or</span>
          <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
        </div>

        <div className="text-center mb-4">
          <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-1">
            Try with a public repository
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Explore the assistant using popular open source projects.
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <fetcher.Form method="post">
          <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden mb-4">
            <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
              {PUBLIC_REPOS.map((repo) => (
                <label
                  key={repo.fullName}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="repos"
                    value={repo.fullName}
                    checked={selected === repo.fullName}
                    onChange={() => setSelected(repo.fullName)}
                    className="w-4 h-4 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100 focus:ring-neutral-500"
                  />
                  <span className="text-neutral-900 dark:text-neutral-100">
                    {repo.fullName}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !selected}
            className="w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-4 py-3 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Setting up..." : "Continue"}
          </button>
        </fetcher.Form>
      </div>
    </div>
  );
}
