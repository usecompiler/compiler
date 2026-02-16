import { useEffect } from "react";
import { useRevalidator, Link } from "react-router";
import type { RepoSyncStatus } from "~/routes/app-layout";

interface RepoSyncGateProps {
  repoSyncStatus: RepoSyncStatus;
  children: React.ReactNode;
}

export function RepoSyncGate({ repoSyncStatus, children }: RepoSyncGateProps) {
  const revalidator = useRevalidator();

  const { hasRepos, allReady, repos } = repoSyncStatus;

  useEffect(() => {
    if (!hasRepos || allReady) return;

    const interval = setInterval(() => {
      revalidator.revalidate();
    }, 2000);

    return () => clearInterval(interval);
  }, [hasRepos, allReady, revalidator]);

  if (!hasRepos || allReady) {
    return <>{children}</>;
  }

  const allFailed = repos.length > 0 && repos.every((r) => r.status === "failed");

  if (allFailed) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-neutral-50 dark:bg-neutral-900 px-4">
        <div className="w-full max-w-lg text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Repository sync failed
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 mb-6">
            All repositories failed to sync. Please check your GitHub connection.
          </p>
          <Link
            to="/settings/github"
            className="inline-block bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-6 py-3 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
          >
            GitHub Settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full items-center justify-center bg-neutral-50 dark:bg-neutral-900 px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Setting up your repositories
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            This may take a moment depending on repository size.
          </p>
        </div>

        <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden mb-6">
          <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {repos.map((repo) => (
              <div
                key={repo.fullName}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <StatusIcon status={repo.status} />
                  <span className="text-neutral-900 dark:text-neutral-100 truncate">
                    {repo.fullName}
                  </span>
                </div>
                <StatusLabel status={repo.status} />
              </div>
            ))}
          </div>
        </div>

        <button
          disabled
          className="w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-4 py-3 opacity-50 cursor-not-allowed"
        >
          Syncing...
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
