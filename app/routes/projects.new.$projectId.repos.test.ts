import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "~/test-utils/mock-db";

const mockDb = createMockDb();
vi.mock("~/lib/db/index.server", () => ({ db: mockDb }));

const requireActiveAuth = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireActiveAuth }));

const getProject = vi.fn();
const addRepoToProject = vi.fn();
vi.mock("~/lib/projects.server", () => ({ getProject, addRepoToProject }));

const getInstallation = vi.fn();
const getOrRefreshAccessToken = vi.fn();
const listInstallationRepos = vi.fn();
const getGitHubAppConfig = vi.fn();
vi.mock("~/lib/github.server", () => ({
  getInstallation,
  getOrRefreshAccessToken,
  listInstallationRepos,
  getGitHubAppConfig,
}));

const cloneRepository = vi.fn();
const clonePublicRepository = vi.fn();
vi.mock("~/lib/clone.server", () => ({ cloneRepository, clonePublicRepository }));

vi.mock("~/lib/db/schema", () => ({
  repositories: {
    id: "repositories.id",
    organizationId: "repositories.organizationId",
    githubRepoId: "repositories.githubRepoId",
    name: "repositories.name",
    fullName: "repositories.fullName",
    cloneUrl: "repositories.cloneUrl",
    isPrivate: "repositories.isPrivate",
    cloneStatus: "repositories.cloneStatus",
  },
  organizations: {
    id: "organizations.id",
    onboardingCompleted: "organizations.onboardingCompleted",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _op: "eq", args }),
  and: (...args: unknown[]) => ({ _op: "and", args }),
}));

function mockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    organization: { id: "org-1", onboardingCompleted: true, createdAt: new Date() },
    membership: { id: "member-1", organizationId: "org-1", role: "owner" as const, isDeactivated: false },
    ...overrides,
  };
}

function buildFormRequest(fields: Record<string, string | string[]>): Request {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        body.append(key, v);
      }
    } else {
      body.append(key, value);
    }
  }
  return new Request("http://localhost/projects/new/proj-1/repos", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

function expectRedirect(result: unknown, location: string) {
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(302);
  expect((result as Response).headers.get("Location")).toBe(location);
}

const sampleRepos = [
  { id: 100, name: "repo-a", fullName: "owner/repo-a", cloneUrl: "https://github.com/owner/repo-a.git", private: false, defaultBranch: "main" },
  { id: 200, name: "repo-b", fullName: "owner/repo-b", cloneUrl: "https://github.com/owner/repo-b.git", private: true, defaultBranch: "main" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockDb._selectCallCount = 0;
  mockDb._selectResults = [[]];
  mockDb._insertValues.mockResolvedValue(undefined);
  mockDb._updateSet.mockClear();
  mockDb._updateWhere.mockResolvedValue(undefined);

  requireActiveAuth.mockResolvedValue(mockUser());
  getProject.mockResolvedValue({ id: "proj-1", name: "Test Project", organizationId: "org-1", createdAt: 0, updatedAt: 0 });
  addRepoToProject.mockResolvedValue(undefined);
  getInstallation.mockResolvedValue(null);
  getOrRefreshAccessToken.mockResolvedValue(null);
  listInstallationRepos.mockResolvedValue([]);
  getGitHubAppConfig.mockResolvedValue(null);
  cloneRepository.mockResolvedValue(undefined);
  clonePublicRepository.mockResolvedValue(undefined);
});

describe("projects.new.$projectId.repos loader", () => {
  async function callLoader(projectId = "proj-1") {
    const { loader } = await import("./projects.new.$projectId.repos");
    return loader({
      request: new Request("http://localhost/projects/new/proj-1/repos"),
      params: { projectId },
    } as never);
  }

  it("redirects to / when no organization", async () => {
    requireActiveAuth.mockResolvedValue(mockUser({ organization: null }));
    const result = await callLoader();
    expectRedirect(result, "/");
  });

  it("redirects to /projects/new when project not found", async () => {
    getProject.mockResolvedValue(null);
    const result = await callLoader();
    expectRedirect(result, "/projects/new");
  });

  it("redirects to /projects/new when project belongs to different org", async () => {
    getProject.mockResolvedValue({ id: "proj-1", name: "Test", organizationId: "other-org", createdAt: 0, updatedAt: 0 });
    const result = await callLoader();
    expectRedirect(result, "/projects/new");
  });

  it("returns hasInstallation false and empty repos when no installation", async () => {
    const result = await callLoader();
    expect(result).toMatchObject({
      hasInstallation: false,
      repos: [],
    });
  });

  it("returns installUrl with project state when no installation but appConfig exists", async () => {
    getGitHubAppConfig.mockResolvedValue({ appId: "123", appSlug: "my-app", privateKey: "key" });
    const result = await callLoader() as Record<string, unknown>;
    expect(result.installUrl).toBe("https://github.com/apps/my-app/installations/new?state=project:proj-1");
    expect(result.hasInstallation).toBe(false);
  });

  it("returns hasAppConfig false when no app config and no installation", async () => {
    const result = await callLoader() as Record<string, unknown>;
    expect(result.hasAppConfig).toBe(false);
  });

  it("returns repos list when installation exists and token valid", async () => {
    getInstallation.mockResolvedValue({ installationId: "inst-1", accessToken: "tok", expiresAt: new Date() });
    getOrRefreshAccessToken.mockResolvedValue("fresh-token");
    listInstallationRepos.mockResolvedValue(sampleRepos);
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;

    const result = await callLoader() as Record<string, unknown>;
    expect(result.hasInstallation).toBe(true);
    expect(result.repos).toEqual(sampleRepos);
  });

  it("filters out already-added repos from the list", async () => {
    getInstallation.mockResolvedValue({ installationId: "inst-1", accessToken: "tok", expiresAt: new Date() });
    getOrRefreshAccessToken.mockResolvedValue("fresh-token");
    listInstallationRepos.mockResolvedValue(sampleRepos);
    mockDb._selectResults = [[{ githubRepoId: "100" }]];
    mockDb._selectCallCount = 0;

    const result = await callLoader() as { repos: typeof sampleRepos };
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].id).toBe(200);
  });
});

describe("projects.new.$projectId.repos action - add-github-repos", () => {
  async function callAction(request: Request, projectId = "proj-1") {
    const { action } = await import("./projects.new.$projectId.repos");
    return action({ request, params: { projectId } } as never);
  }

  it("returns error when no repos selected", async () => {
    const req = buildFormRequest({
      intent: "add-github-repos",
      reposData: JSON.stringify(sampleRepos),
    });
    const result = await callAction(req);
    expect(result).toEqual({ error: "Please select at least one repository" });
  });

  it("inserts repo records and calls addRepoToProject for each", async () => {
    const req = buildFormRequest({
      intent: "add-github-repos",
      repos: ["100", "200"],
      reposData: JSON.stringify(sampleRepos),
    });

    await callAction(req);
    expect(mockDb._insertValues).toHaveBeenCalledTimes(2);
    expect(addRepoToProject).toHaveBeenCalledTimes(2);
  });

  it("triggers cloneRepository for each repo", async () => {
    const req = buildFormRequest({
      intent: "add-github-repos",
      repos: ["100"],
      reposData: JSON.stringify(sampleRepos),
    });

    await callAction(req);
    expect(cloneRepository).toHaveBeenCalledWith("org-1", expect.any(String), "repo-a", "https://github.com/owner/repo-a.git");
  });

  it("marks onboarding complete when isOnboarding is true", async () => {
    requireActiveAuth.mockResolvedValue(
      mockUser({ organization: { id: "org-1", onboardingCompleted: false, createdAt: new Date() } })
    );
    const req = buildFormRequest({
      intent: "add-github-repos",
      repos: ["100"],
      reposData: JSON.stringify(sampleRepos),
    });

    await callAction(req);
    expect(mockDb._updateSet).toHaveBeenCalledWith({ onboardingCompleted: true });
  });

  it("does NOT mark onboarding complete when already onboarded", async () => {
    const req = buildFormRequest({
      intent: "add-github-repos",
      repos: ["100"],
      reposData: JSON.stringify(sampleRepos),
    });

    await callAction(req);
    expect(mockDb._updateSet).not.toHaveBeenCalled();
  });

  it("redirects to syncing page on success", async () => {
    const req = buildFormRequest({
      intent: "add-github-repos",
      repos: ["100"],
      reposData: JSON.stringify(sampleRepos),
    });

    const result = await callAction(req);
    expectRedirect(result, "/projects/new/proj-1/syncing");
  });
});

describe("projects.new.$projectId.repos action - add-public-repo", () => {
  async function callAction(request: Request, projectId = "proj-1") {
    const { action } = await import("./projects.new.$projectId.repos");
    return action({ request, params: { projectId } } as never);
  }

  it("returns error when repoUrl is missing", async () => {
    const req = buildFormRequest({ intent: "add-public-repo" });
    const result = await callAction(req);
    expect(result).toEqual({ error: "Repository URL is required" });
  });

  it("returns error for invalid GitHub URL", async () => {
    const req = buildFormRequest({ intent: "add-public-repo", repoUrl: "https://example.com/foo" });
    const result = await callAction(req);
    expect(result).toEqual({ error: "Invalid GitHub URL. Use a URL like https://github.com/owner/repo" });
  });

  it("parses owner/repo from standard URL", async () => {
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;
    const req = buildFormRequest({ intent: "add-public-repo", repoUrl: "https://github.com/owner/my-repo" });

    await callAction(req);
    expect(mockDb._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "owner/my-repo", name: "my-repo" })
    );
  });

  it("parses owner/repo from URL with .git suffix", async () => {
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;
    const req = buildFormRequest({ intent: "add-public-repo", repoUrl: "https://github.com/owner/my-repo.git" });

    await callAction(req);
    expect(mockDb._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "owner/my-repo", name: "my-repo" })
    );
  });

  it("links existing repo when duplicate fullName found", async () => {
    mockDb._selectResults = [[{ id: "existing-repo-id" }]];
    mockDb._selectCallCount = 0;
    const req = buildFormRequest({ intent: "add-public-repo", repoUrl: "https://github.com/owner/my-repo" });

    await callAction(req);
    expect(addRepoToProject).toHaveBeenCalledWith("proj-1", "existing-repo-id");
    expect(mockDb._insertValues).not.toHaveBeenCalled();
  });

  it("inserts new repo and triggers clone for new repos", async () => {
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;
    const req = buildFormRequest({ intent: "add-public-repo", repoUrl: "https://github.com/owner/my-repo" });

    await callAction(req);
    expect(mockDb._insertValues).toHaveBeenCalled();
    expect(addRepoToProject).toHaveBeenCalled();
    expect(clonePublicRepository).toHaveBeenCalledWith("org-1", expect.any(String), "my-repo", "https://github.com/owner/my-repo.git");
  });

  it("sets githubRepoId to null and isPrivate to false for public repos", async () => {
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;
    const req = buildFormRequest({ intent: "add-public-repo", repoUrl: "https://github.com/owner/my-repo" });

    await callAction(req);
    expect(mockDb._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ githubRepoId: null, isPrivate: false })
    );
  });

  it("marks onboarding complete when isOnboarding", async () => {
    requireActiveAuth.mockResolvedValue(
      mockUser({ organization: { id: "org-1", onboardingCompleted: false, createdAt: new Date() } })
    );
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;
    const req = buildFormRequest({ intent: "add-public-repo", repoUrl: "https://github.com/owner/my-repo" });

    await callAction(req);
    expect(mockDb._updateSet).toHaveBeenCalledWith({ onboardingCompleted: true });
  });

  it("redirects to syncing page on success", async () => {
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;
    const req = buildFormRequest({ intent: "add-public-repo", repoUrl: "https://github.com/owner/my-repo" });

    const result = await callAction(req);
    expectRedirect(result, "/projects/new/proj-1/syncing");
  });
});

describe("projects.new.$projectId.repos action - invalid intent", () => {
  it("returns error for unknown intent", async () => {
    const req = buildFormRequest({ intent: "unknown-intent" });
    const { action } = await import("./projects.new.$projectId.repos");
    const result = await action({ request: req, params: { projectId: "proj-1" } } as never);
    expect(result).toEqual({ error: "Invalid action" });
  });
});
