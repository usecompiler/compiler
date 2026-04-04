import { useState, useEffect, Suspense } from "react";
import { Await, Link, useLoaderData, useRevalidator, useFetcher, redirect } from "react-router";
import type { Route } from "./+types/settings.projects";
import { requireActiveAuth } from "~/lib/auth.server";
import { canManageOrganization } from "~/lib/permissions.server";
import {
  getProjects,
  getProjectRepos,
  addRepoToProject,
  removeRepoFromProject,
  createProject,
  updateProject,
  deleteProject,
} from "~/lib/projects.server";
import { logAuditEvent } from "~/lib/audit.server";
import { db } from "~/lib/db/index.server";
import { repositories } from "~/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getInstallation,
  getOrRefreshAccessToken,
  listInstallationRepos,
  type GitHubRepo,
} from "~/lib/github.server";
import { cloneRepository, clonePublicRepository, deleteRepository } from "~/lib/clone.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const canManageOrg = canManageOrganization(user.membership?.role);

  if (!canManageOrg || !user.organization) {
    throw redirect("/settings");
  }

  const orgId = user.organization.id;

  const [projectsList, allOrgRepos, installation] = await Promise.all([
    getProjects(orgId),
    db
      .select({
        id: repositories.id,
        name: repositories.name,
        fullName: repositories.fullName,
        githubRepoId: repositories.githubRepoId,
        isPrivate: repositories.isPrivate,
        cloneStatus: repositories.cloneStatus,
      })
      .from(repositories)
      .where(eq(repositories.organizationId, orgId))
      .orderBy(repositories.name),
    getInstallation(orgId),
  ]);

  const projectsWithRepos = await Promise.all(
    projectsList.map(async (project) => {
      const repos = await getProjectRepos(project.id, orgId);
      return { ...project, repos };
    })
  );

  let githubReposPromise: Promise<GitHubRepo[]>;
  if (installation?.status === "active") {
    githubReposPromise = (async () => {
      const accessToken = await getOrRefreshAccessToken(orgId);
      if (!accessToken) return [];
      const allGithubRepos = await listInstallationRepos(accessToken);
      const existingGithubIds = new Set(allOrgRepos.map((r) => r.githubRepoId));
      return allGithubRepos.filter((r) => !existingGithubIds.has(r.id.toString()));
    })();
  } else {
    githubReposPromise = Promise.resolve([]);
  }

  return {
    projects: projectsWithRepos,
    allRepos: allOrgRepos,
    githubReposPromise,
    hasInstallation: !!installation,
    organizationId: orgId,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization || !canManageOrganization(user.membership?.role)) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create-project") {
    const name = (formData.get("name") as string)?.trim();
    if (!name) {
      return Response.json({ error: "Name is required" }, { status: 400 });
    }
    await createProject(user.organization.id, name);
    return Response.json({ success: true, message: "Project created", intent: "create-project" });
  }

  if (intent === "rename-project") {
    const projectId = formData.get("projectId") as string;
    const name = (formData.get("name") as string)?.trim();
    if (!projectId || !name) {
      return Response.json({ error: "Project ID and name are required" }, { status: 400 });
    }
    await updateProject(projectId, user.organization.id, name);
    return Response.json({ success: true, message: "Project renamed", intent: "rename-project" });
  }

  if (intent === "delete-project") {
    const projectId = formData.get("projectId") as string;
    if (!projectId) {
      return Response.json({ error: "Project ID is required" }, { status: 400 });
    }
    const result = await deleteProject(projectId, user.organization.id);
    if (!result.success) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json({ success: true, message: "Project deleted", intent: "delete-project" });
  }

  if (intent === "assign-repo") {
    const projectId = formData.get("projectId") as string;
    const repositoryId = formData.get("repositoryId") as string;
    if (!projectId || !repositoryId) {
      return Response.json({ error: "Project and repository are required" }, { status: 400 });
    }
    await addRepoToProject(projectId, repositoryId, user.organization.id);
    return Response.json({ success: true, intent: "assign-repo" });
  }

  if (intent === "unassign-repo") {
    const projectId = formData.get("projectId") as string;
    const repositoryId = formData.get("repositoryId") as string;
    if (!projectId || !repositoryId) {
      return Response.json({ error: "Project and repository are required" }, { status: 400 });
    }
    await removeRepoFromProject(projectId, repositoryId, user.organization.id);
    return Response.json({ success: true, intent: "unassign-repo" });
  }

  if (intent === "add-github-repos") {
    const projectId = formData.get("projectId") as string;
    const repoData = formData.get("repoData") as string;

    if (!projectId || !repoData) {
      return Response.json({ error: "Missing repository data" }, { status: 400 });
    }

    const repo: GitHubRepo = JSON.parse(repoData);
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

    cloneRepository(
      user.organization.id,
      repoId,
      repo.name,
      repo.cloneUrl
    ).catch(console.error);

    await logAuditEvent(
      user.organization.id,
      user.id,
      `added repository ${repo.fullName}`
    );
    return Response.json({ success: true, message: "Repository added", intent: "add-github-repos" });
  }

  if (intent === "add-public-repo") {
    const projectId = formData.get("projectId") as string;
    const repoUrl = (formData.get("repoUrl") as string)?.trim();

    if (!projectId) {
      return Response.json({ error: "Project is required" }, { status: 400 });
    }

    if (!repoUrl) {
      return Response.json({ error: "Repository URL is required" }, { status: 400 });
    }

    const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/.*)?$/);
    if (!match) {
      return Response.json({ error: "Invalid GitHub URL. Use a URL like https://github.com/owner/repo" }, { status: 400 });
    }

    const fullName = match[1];
    const name = fullName.split("/")[1];
    const cloneUrl = `https://github.com/${fullName}.git`;

    const existingByName = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(
        and(
          eq(repositories.organizationId, user.organization.id),
          eq(repositories.fullName, fullName)
        )
      )
      .limit(1);

    if (existingByName.length > 0) {
      await addRepoToProject(projectId, existingByName[0].id, user.organization.id);
      return Response.json({ success: true });
    }

    const repoId = crypto.randomUUID();
    await db.insert(repositories).values({
      id: repoId,
      organizationId: user.organization.id,
      githubRepoId: null,
      name,
      fullName,
      cloneUrl,
      isPrivate: false,
      cloneStatus: "pending",
    });

    await addRepoToProject(projectId, repoId, user.organization.id);

    clonePublicRepository(user.organization.id, repoId, name, cloneUrl).catch(console.error);

    await logAuditEvent(user.organization.id, user.id, `added public repository ${fullName}`);
    return Response.json({ success: true, message: "Repository added", intent: "add-public-repo" });
  }

  if (intent === "remove-repo") {
    const repoId = formData.get("repoId") as string;
    const repoName = formData.get("repoName") as string;

    await deleteRepository(user.organization.id, repoId, repoName);
    await logAuditEvent(user.organization.id, user.id, "removed repository", { repoName });
    return Response.json({ success: true, message: "Repository removed", intent: "remove-repo" });
  }

  return Response.json({ error: "Invalid action" }, { status: 400 });
}

function CloneStatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500">
        <span className="w-1.5 h-1.5 rounded-full bg-green-600 dark:bg-green-500" />
        Synced
      </span>
    );
  }
  if (status === "cloning") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-500">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-500 animate-pulse" />
        Syncing
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

export default function SettingsProjects() {
  const { projects, allRepos, githubReposPromise, hasInstallation } =
    useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<typeof action>();
  const [newProjectName, setNewProjectName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [addingToProject, setAddingToProject] = useState<string | null>(null);
  const [publicRepoUrl, setPublicRepoUrl] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetcherData = fetcher.data as { success?: boolean; error?: string; message?: string; intent?: string } | undefined;
  const fetcherError = fetcher.state === "idle" ? fetcherData?.error ?? null : null;

  const hasInProgressClones = allRepos.some(
    (r) => r.cloneStatus === "pending" || r.cloneStatus === "cloning"
  );

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  useEffect(() => {
    if (!hasInProgressClones) return;
    const interval = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(interval);
  }, [hasInProgressClones, revalidator]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcherData?.success) return;
    const { intent, message } = fetcherData;

    if (intent === "create-project") {
      setNewProjectName("");
    }
    if (intent === "rename-project") {
      setEditingId(null);
    }
    if (intent === "add-public-repo" || intent === "add-github-repos") {
      setPublicRepoUrl("");
      setAddingToProject(null);
    }
    if (message) {
      setSuccessMessage(message);
    }
  }, [fetcher.state, fetcherData]);

  const handleCreate = () => {
    if (!newProjectName.trim()) return;
    fetcher.submit(
      { intent: "create-project", name: newProjectName.trim() },
      { method: "POST" }
    );
  };

  const handleRename = (projectId: string) => {
    if (!editingName.trim()) return;
    fetcher.submit(
      { intent: "rename-project", projectId, name: editingName.trim() },
      { method: "POST" }
    );
  };

  const handleDelete = (projectId: string) => {
    if (!confirm("Delete this project? Conversations in this project will also be deleted.")) {
      return;
    }
    fetcher.submit(
      { intent: "delete-project", projectId },
      { method: "POST" }
    );
  };

  const handleToggleRepo = (
    projectId: string,
    repositoryId: string,
    isAssigned: boolean
  ) => {
    fetcher.submit(
      {
        intent: isAssigned ? "unassign-repo" : "assign-repo",
        projectId,
        repositoryId,
      },
      { method: "POST" }
    );
  };

  const handleRemoveRepo = (repoId: string, repoName: string) => {
    if (!confirm(`Remove ${repoName}? This will remove it from all projects and delete synced data.`)) {
      return;
    }
    fetcher.submit(
      { intent: "remove-repo", repoId, repoName },
      { method: "POST" }
    );
  };

  const handleAddSingleGithubRepo = (projectId: string, repo: GitHubRepo) => {
    fetcher.submit(
      { intent: "add-github-repos", projectId, repoData: JSON.stringify(repo) },
      { method: "POST" }
    );
  };

  const handleAddPublicRepo = (projectId: string) => {
    if (!publicRepoUrl.trim()) return;
    fetcher.submit(
      { intent: "add-public-repo", projectId, repoUrl: publicRepoUrl.trim() },
      { method: "POST" }
    );
  };

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
            <Link to="/settings" className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent">
              Account
            </Link>
            <Link to="/settings/ai-provider" className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent">
              AI Provider
            </Link>
            <Link to="/settings/audit-log" className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent">
              Audit Log
            </Link>
            <Link to="/settings/authentication" className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent">
              Authentication
            </Link>
            <Link to="/settings/github" className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent">
              GitHub
            </Link>
            <Link to="/settings/organization" className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent">
              Organization
            </Link>
            <span className="py-3 text-sm text-neutral-900 dark:text-neutral-100 font-medium border-b-2 border-neutral-900 dark:border-neutral-100">
              Projects
            </span>
            <Link to="/settings/storage" className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent">
              Storage
            </Link>
          </nav>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {fetcherError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {fetcherError}
          </div>
        )}
        {successMessage && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 text-sm text-green-600 dark:text-green-400">
            {successMessage}
          </div>
        )}

        <section>
          <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
            Create Project
          </h2>
          <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6">
            <div className="flex gap-3">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
                className="flex-1 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
              />
              <button
                onClick={handleCreate}
                disabled={!newProjectName.trim()}
                className="px-4 py-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
            Projects
          </h2>
          <div className="space-y-4">
            {projects.map(
              (project: {
                id: string;
                name: string;
                repos: { id: string; name: string; fullName: string; cloneStatus: string }[];
              }) => (
                <div
                  key={project.id}
                  className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden"
                >
                  <div className="px-6 py-4 flex items-center justify-between border-b border-neutral-200 dark:border-neutral-700">
                    {editingId === project.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(project.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                          className="flex-1 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                        />
                        <button
                          onClick={() => handleRename(project.id)}
                          className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
                            {project.name}
                          </h3>
                          <p className="text-sm text-neutral-500 dark:text-neutral-400">
                            {project.repos.length}{" "}
                            {project.repos.length === 1 ? "repository" : "repositories"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setEditingId(project.id);
                              setEditingName(project.name);
                            }}
                            className="p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                            </svg>
                          </button>
                          {projects.length > 1 && (
                            <button
                              onClick={() => handleDelete(project.id)}
                              className="p-1.5 text-neutral-400 hover:text-red-500 transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="px-6 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                        Repositories
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (addingToProject === project.id) {
                            setAddingToProject(null);
                            setPublicRepoUrl("");
                          } else {
                            setAddingToProject(project.id);
                            setPublicRepoUrl("");
                          }
                        }}
                        className="text-xs text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100"
                      >
                        {addingToProject === project.id ? "Cancel" : "Add repository"}
                      </button>
                    </div>

                    {addingToProject === project.id && (
                      <div className="mb-3 border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden">
                        <div className="p-4 border-b border-neutral-200 dark:border-neutral-700">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={publicRepoUrl}
                              onChange={(e) => setPublicRepoUrl(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleAddPublicRepo(project.id);
                              }}
                              placeholder="https://github.com/owner/repo"
                              className="flex-1 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddPublicRepo(project.id)}
                              disabled={!publicRepoUrl.trim() || fetcher.state !== "idle"}
                              className="px-3 py-2 text-sm font-medium bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {fetcher.state !== "idle" ? "Adding..." : "Add"}
                            </button>
                          </div>
                          <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                            Paste a GitHub URL to add any public repository.
                          </p>
                        </div>

                        {(() => {
                          const unassignedOrgRepos = allRepos.filter(
                            (r) => !project.repos.some((pr) => pr.id === r.id)
                          );
                          const hasOrgRepos = unassignedOrgRepos.length > 0;

                          return (
                            <>
                              {hasOrgRepos && (
                                <div>
                                  <div className="px-4 py-2 bg-neutral-50 dark:bg-neutral-800/50 border-b border-neutral-200 dark:border-neutral-700">
                                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                                      In your organization
                                    </p>
                                  </div>
                                  <div className="max-h-48 overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-700">
                                    {unassignedOrgRepos.map((repo) => (
                                      <button
                                        key={repo.id}
                                        type="button"
                                        onClick={() => handleToggleRepo(project.id, repo.id, false)}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 text-left"
                                      >
                                        <svg className="w-4 h-4 flex-shrink-0 text-neutral-400 dark:text-neutral-500" viewBox="0 0 24 24" fill="currentColor">
                                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                                        </svg>
                                        <span className="text-sm text-neutral-900 dark:text-neutral-100 truncate">
                                          {repo.fullName}
                                        </span>
                                        <CloneStatusBadge status={repo.cloneStatus} />
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {hasInstallation && (
                                <div>
                                  <div className="px-4 py-2 bg-neutral-50 dark:bg-neutral-800/50 border-b border-neutral-200 dark:border-neutral-700">
                                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                                      From GitHub App
                                    </p>
                                  </div>
                                  <Suspense
                                    fallback={
                                      <div className="px-4 py-6 flex items-center justify-center">
                                        <svg className="w-4 h-4 text-neutral-400 animate-spin" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        <span className="ml-2 text-sm text-neutral-500 dark:text-neutral-400">Loading GitHub repositories...</span>
                                      </div>
                                    }
                                  >
                                    <Await resolve={githubReposPromise}>
                                      {(githubRepos) =>
                                        githubRepos.length === 0 ? (
                                          <div className="px-4 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                                            All accessible GitHub repositories have already been added.
                                          </div>
                                        ) : (
                                          <div className="max-h-48 overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-700">
                                            {githubRepos.map((repo: GitHubRepo) => (
                                              <button
                                                key={repo.id}
                                                type="button"
                                                onClick={() => handleAddSingleGithubRepo(project.id, repo)}
                                                disabled={fetcher.state !== "idle"}
                                                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                                              >
                                                <svg className="w-4 h-4 flex-shrink-0 text-neutral-400 dark:text-neutral-500" viewBox="0 0 24 24" fill="currentColor">
                                                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                                                </svg>
                                                <span className="text-sm text-neutral-900 dark:text-neutral-100 truncate">
                                                  {repo.fullName}
                                                </span>
                                                <span className="flex-shrink-0 px-1.5 py-0.5 text-xs bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 rounded">
                                                  GitHub
                                                </span>
                                                {repo.private && (
                                                  <span className="flex-shrink-0 px-1.5 py-0.5 text-xs bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 rounded">
                                                    Private
                                                  </span>
                                                )}
                                              </button>
                                            ))}
                                          </div>
                                        )
                                      }
                                    </Await>
                                  </Suspense>
                                </div>
                              )}

                              {!hasOrgRepos && !hasInstallation && (
                                <div className="px-4 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                                  No additional repositories available.
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}

                    <div className="space-y-1">
                        {project.repos.length === 0 && addingToProject !== project.id && (
                          <p className="text-sm text-neutral-400 dark:text-neutral-500 py-2">
                            No repositories assigned to this project.
                          </p>
                        )}
                        {project.repos.map(
                          (repo: { id: string; name: string; fullName: string; cloneStatus: string }) => (
                            <div
                              key={repo.id}
                              className="flex items-center justify-between py-1.5 group"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <svg className="w-4 h-4 flex-shrink-0 text-neutral-400 dark:text-neutral-500" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                                </svg>
                                <span className="text-sm text-neutral-900 dark:text-neutral-100 truncate">
                                  {repo.fullName}
                                </span>
                                <CloneStatusBadge status={repo.cloneStatus} />
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => handleToggleRepo(project.id, repo.id, true)}
                                  className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                                  title="Remove from project"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleRemoveRepo(repo.id, repo.name)}
                                  className="p-1 text-neutral-400 hover:text-red-500 transition-colors"
                                  title="Delete repository"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                  </div>
                </div>
              )
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
