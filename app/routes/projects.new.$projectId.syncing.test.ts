import { describe, it, expect, vi, beforeEach } from "vitest";

const requireActiveAuth = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireActiveAuth }));

const getProject = vi.fn();
const getProjectRepos = vi.fn();
vi.mock("~/lib/projects.server", () => ({ getProject, getProjectRepos }));

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

function expectRedirect(result: unknown, location: string) {
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(302);
  expect((result as Response).headers.get("Location")).toBe(location);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActiveAuth.mockResolvedValue(mockUser());
  getProject.mockResolvedValue({ id: "proj-1", name: "Test Project", organizationId: "org-1", createdAt: 0, updatedAt: 0 });
  getProjectRepos.mockResolvedValue([
    { id: "repo-1", name: "my-repo", fullName: "owner/my-repo", cloneUrl: "https://github.com/owner/my-repo.git", isPrivate: false, cloneStatus: "completed" },
  ]);
});

describe("projects.new.$projectId.syncing loader", () => {
  async function callLoader(projectId = "proj-1") {
    const { loader } = await import("./projects.new.$projectId.syncing");
    return loader({
      request: new Request("http://localhost/projects/new/proj-1/syncing"),
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

  it("redirects to repos page when project has no repos", async () => {
    getProjectRepos.mockResolvedValue([]);
    const result = await callLoader();
    expectRedirect(result, "/projects/new/proj-1/repos");
  });

  it("returns projectId, projectName, repos, isPostOnboarding", async () => {
    const result = await callLoader();
    expect(result).toEqual({
      projectId: "proj-1",
      projectName: "Test Project",
      repos: [{ id: "repo-1", name: "my-repo", fullName: "owner/my-repo", cloneStatus: "completed" }],
      isPostOnboarding: true,
    });
  });

  it("maps repos to only id, name, fullName, cloneStatus", async () => {
    getProjectRepos.mockResolvedValue([
      { id: "repo-1", name: "my-repo", fullName: "owner/my-repo", cloneUrl: "https://github.com/owner/my-repo.git", isPrivate: true, cloneStatus: "pending", extraField: "ignored" },
    ]);
    const result = await callLoader();
    const repo = (result as { repos: Record<string, unknown>[] }).repos[0];
    expect(repo).toEqual({ id: "repo-1", name: "my-repo", fullName: "owner/my-repo", cloneStatus: "pending" });
    expect(repo).not.toHaveProperty("cloneUrl");
    expect(repo).not.toHaveProperty("isPrivate");
  });
});
