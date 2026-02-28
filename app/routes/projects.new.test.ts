import { describe, it, expect, vi, beforeEach } from "vitest";

const requireActiveAuth = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireActiveAuth }));

const createProject = vi.fn();
vi.mock("~/lib/projects.server", () => ({ createProject }));

const isSelfHosted = vi.fn();
vi.mock("~/lib/appMode.server", () => ({ isSelfHosted }));

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

function buildFormRequest(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields);
  return new Request("http://localhost/projects/new", {
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

beforeEach(() => {
  vi.clearAllMocks();
  requireActiveAuth.mockResolvedValue(mockUser());
  isSelfHosted.mockReturnValue(false);
});

describe("projects.new loader", () => {
  async function callLoader(request?: Request) {
    const { loader } = await import("./projects.new");
    return loader({ request: request ?? new Request("http://localhost/projects/new") } as never);
  }

  it("redirects to / when user has no organization", async () => {
    requireActiveAuth.mockResolvedValue(mockUser({ organization: null }));
    const result = await callLoader();
    expectRedirect(result, "/");
  });

  it("returns isOnboarding false when onboardingCompleted is true", async () => {
    const result = await callLoader();
    expect(result).toEqual({ isOnboarding: false });
  });

  it("returns isOnboarding true when onboardingCompleted is false", async () => {
    requireActiveAuth.mockResolvedValue(
      mockUser({ organization: { id: "org-1", onboardingCompleted: false, createdAt: new Date() } })
    );
    const result = await callLoader();
    expect(result).toEqual({ isOnboarding: true });
  });

  it("redirects to / when onboarding and role is not owner", async () => {
    requireActiveAuth.mockResolvedValue(
      mockUser({
        organization: { id: "org-1", onboardingCompleted: false, createdAt: new Date() },
        membership: { id: "member-1", organizationId: "org-1", role: "member", isDeactivated: false },
      })
    );
    const result = await callLoader();
    expectRedirect(result, "/");
  });

  it("redirects to /onboarding/github-app when onboarding and self-hosted", async () => {
    requireActiveAuth.mockResolvedValue(
      mockUser({ organization: { id: "org-1", onboardingCompleted: false, createdAt: new Date() } })
    );
    isSelfHosted.mockReturnValue(true);
    const result = await callLoader();
    expectRedirect(result, "/onboarding/github-app");
  });

  it("does not redirect when onboarding, owner, not self-hosted", async () => {
    requireActiveAuth.mockResolvedValue(
      mockUser({ organization: { id: "org-1", onboardingCompleted: false, createdAt: new Date() } })
    );
    const result = await callLoader();
    expect(result).toEqual({ isOnboarding: true });
  });
});

describe("projects.new action", () => {
  async function callAction(request: Request) {
    const { action } = await import("./projects.new");
    return action({ request } as never);
  }

  it("redirects to / when user has no organization", async () => {
    requireActiveAuth.mockResolvedValue(mockUser({ organization: null }));
    const result = await callAction(buildFormRequest({ name: "Test" }));
    expectRedirect(result, "/");
  });

  it("returns error when name is empty", async () => {
    const result = await callAction(buildFormRequest({ name: "" }));
    expect(result).toEqual({ error: "Project name is required" });
  });

  it("returns error when name is whitespace only", async () => {
    const result = await callAction(buildFormRequest({ name: "   " }));
    expect(result).toEqual({ error: "Project name is required" });
  });

  it("calls createProject with org id and trimmed name", async () => {
    createProject.mockResolvedValue({ id: "proj-1", name: "My Project", organizationId: "org-1", createdAt: 0, updatedAt: 0 });
    await callAction(buildFormRequest({ name: "  My Project  " }));
    expect(createProject).toHaveBeenCalledWith("org-1", "My Project");
  });

  it("redirects to /projects/new/{id}/repos on success", async () => {
    createProject.mockResolvedValue({ id: "proj-1", name: "My Project", organizationId: "org-1", createdAt: 0, updatedAt: 0 });
    const result = await callAction(buildFormRequest({ name: "My Project" }));
    expectRedirect(result, "/projects/new/proj-1/repos");
  });
});
