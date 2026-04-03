import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "~/test-utils/mock-db";

const mockDb = createMockDb();
vi.mock("~/lib/db/index.server", () => ({ db: mockDb }));

const requireActiveAuth = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireActiveAuth }));

const getInstallation = vi.fn();
const getGitHubAppConfig = vi.fn();
const listAppInstallations = vi.fn();
const getInstallationAccessToken = vi.fn();
const saveInstallation = vi.fn();
vi.mock("~/lib/github.server", () => ({
  getInstallation,
  getGitHubAppConfig,
  listAppInstallations,
  getInstallationAccessToken,
  saveInstallation,
}));

const isSaasMock = vi.fn();
vi.mock("~/lib/appMode.server", () => ({
  isSaas: () => isSaasMock(),
}));

vi.mock("~/lib/clone.server", () => ({
  clonePublicRepository: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _op: "eq", args }),
}));

vi.mock("~/lib/db/schema", () => ({
  repositories: {},
  organizations: {},
}));

function mockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    organization: { id: "org-1", onboardingCompleted: false, createdAt: new Date() },
    membership: { id: "member-1", organizationId: "org-1", role: "owner" as const, isDeactivated: false },
    ...overrides,
  };
}

function buildLoaderRequest() {
  return new Request("http://localhost/onboarding/github", { method: "GET" });
}

function buildActionRequest(formFields: Record<string, string>) {
  const formData = new URLSearchParams(formFields);
  return new Request("http://localhost/onboarding/github", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  requireActiveAuth.mockResolvedValue(mockUser());
  getGitHubAppConfig.mockResolvedValue({ appSlug: "test-app" });
  getInstallation.mockResolvedValue(null);
  isSaasMock.mockReturnValue(false);
});

describe("onboarding.github loader", () => {
  async function callLoader(request: Request) {
    const mod = await import("./onboarding.github");
    return mod.loader({ request } as never);
  }

  it("skips listAppInstallations in SaaS mode and returns no_installation", async () => {
    isSaasMock.mockReturnValue(true);

    const result = await callLoader(buildLoaderRequest());

    expect(listAppInstallations).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "no_installation",
      appSlug: "test-app",
      orgId: "org-1",
    });
  });

  it("calls listAppInstallations in self-hosted mode", async () => {
    isSaasMock.mockReturnValue(false);
    listAppInstallations.mockResolvedValue([
      { id: 123, account: { login: "pnicholls", id: 1, type: "User" }, repositorySelection: "all" },
    ]);

    const result = await callLoader(buildLoaderRequest());

    expect(listAppInstallations).toHaveBeenCalledWith("org-1");
    expect(result).toEqual({
      status: "single_installation",
      installation: { id: 123, account: { login: "pnicholls", id: 1, type: "User" }, repositorySelection: "all" },
      orgId: "org-1",
    });
  });
});

describe("onboarding.github action", () => {
  async function callAction(request: Request) {
    const mod = await import("./onboarding.github");
    return mod.action({ request } as never);
  }

  it("blocks link_installation in SaaS mode", async () => {
    isSaasMock.mockReturnValue(true);

    const request = buildActionRequest({
      intent: "link_installation",
      installationId: "999",
    });
    const result = await callAction(request);

    expect(result).toEqual({ error: "Use the GitHub App install flow" });
    expect(getInstallationAccessToken).not.toHaveBeenCalled();
    expect(saveInstallation).not.toHaveBeenCalled();
  });

  it("allows link_installation in self-hosted mode", async () => {
    isSaasMock.mockReturnValue(false);
    getInstallationAccessToken.mockResolvedValue({
      token: "ghs_test",
      expiresAt: new Date("2026-12-31"),
    });
    saveInstallation.mockResolvedValue(undefined);

    const request = buildActionRequest({
      intent: "link_installation",
      installationId: "123",
    });
    const result = await callAction(request);

    expect(getInstallationAccessToken).toHaveBeenCalledWith("org-1", "123");
    expect(saveInstallation).toHaveBeenCalled();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
  });
});
