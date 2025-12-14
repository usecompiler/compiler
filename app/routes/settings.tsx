import type { Route } from "./+types/settings";
import { Link, useLoaderData } from "react-router";
import path from "node:path";
import fs from "node:fs";

const REPOS_DIR = path.resolve(process.cwd(), "repos");

interface Repo {
  name: string;
  hasGit: boolean;
}

export async function loader(): Promise<Repo[]> {
  const repos: Repo[] = [];

  try {
    const entries = fs.readdirSync(REPOS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const projectPath = path.join(REPOS_DIR, entry.name);
        const gitPath = path.join(projectPath, ".git");
        repos.push({
          name: entry.name,
          hasGit: fs.existsSync(gitPath),
        });
      }
    }
  } catch {
    // repos directory doesn't exist or isn't readable
  }

  return repos;
}

export default function Settings() {
  const repos = useLoaderData<typeof loader>();

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

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        <section>
          <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
            Repositories
          </h2>

          {repos.length === 0 ? (
            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6 text-center">
              <p className="text-neutral-500 dark:text-neutral-400">No repositories found</p>
              <p className="text-sm text-neutral-400 dark:text-neutral-500 mt-2">
                Clone a git repository into the repos/ directory to get started.
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg divide-y divide-neutral-200 dark:divide-neutral-700">
              {repos.map((repo) => (
                <div
                  key={repo.name}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-neutral-400 dark:text-neutral-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                    </svg>
                    <span className="text-neutral-900 dark:text-neutral-100">{repo.name}</span>
                  </div>
                  {repo.hasGit ? (
                    <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-600 dark:bg-green-500" />
                      Git
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">No git</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-4">
            The assistant will explore the first repository with a .git folder.
          </p>
        </section>
      </main>
    </div>
  );
}
