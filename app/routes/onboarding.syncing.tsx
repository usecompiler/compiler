import { redirect, useNavigate, useRevalidator } from "react-router";
import { useEffect } from "react";
import type { Route } from "./+types/onboarding.syncing";
import { requireActiveAuth } from "~/lib/auth.server";
import { db } from "~/lib/db/index.server";
import { repositories } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

interface Repo {
  id: string;
  name: string;
  fullName: string;
  cloneStatus: string;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization) {
    return redirect("/");
  }

  if (!user.organization.onboardingCompleted) {
    return redirect("/onboarding/repos");
  }

  const repos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.organizationId, user.organization.id))
    .orderBy(repositories.name);

  return {
    repos: repos.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.fullName,
      cloneStatus: r.cloneStatus,
    })),
  };
}

export default function OnboardingSyncing({ loaderData }: Route.ComponentProps) {
  const { repos } = loaderData;
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const allDone = repos.every(
    (r: Repo) => r.cloneStatus === "completed" || r.cloneStatus === "failed"
  );
  const hasFailures = repos.some((r: Repo) => r.cloneStatus === "failed");

  useEffect(() => {
    if (allDone) return;

    const interval = setInterval(() => {
      revalidator.revalidate();
    }, 2000);

    return () => clearInterval(interval);
  }, [allDone, revalidator]);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            {allDone ? "Repositories ready" : "Setting up your repositories"}
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            {allDone
              ? hasFailures
                ? "Some repositories failed to sync. You can retry from settings."
                : "All repositories have been synced successfully."
              : "This may take a moment depending on repository size."}
          </p>
        </div>

        <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden mb-6">
          <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {repos.map((repo: Repo) => (
              <div
                key={repo.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <StatusIcon status={repo.cloneStatus} />
                  <span className="text-neutral-900 dark:text-neutral-100 truncate">
                    {repo.fullName}
                  </span>
                </div>
                <StatusLabel status={repo.cloneStatus} />
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={() => navigate("/")}
          disabled={!allDone}
          className="w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-4 py-3 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {allDone ? "Continue" : "Syncing..."}
        </button>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <svg
        className="w-5 h-5 text-green-500"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m4.5 12.75 6 6 9-13.5"
        />
      </svg>
    );
  }

  if (status === "failed") {
    return (
      <svg
        className="w-5 h-5 text-red-500"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 18 18 6M6 6l12 12"
        />
      </svg>
    );
  }

  return (
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
  );
}

function StatusLabel({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className="text-sm text-green-600 dark:text-green-500">Ready</span>
    );
  }

  if (status === "failed") {
    return (
      <span className="text-sm text-red-600 dark:text-red-500">Failed</span>
    );
  }

  return (
    <span className="text-sm text-neutral-500 dark:text-neutral-400">
      Syncing
    </span>
  );
}
