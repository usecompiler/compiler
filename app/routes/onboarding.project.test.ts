import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "~/test-utils/mock-db";

const mockDb = createMockDb();
vi.mock("~/lib/db/index.server", () => ({ db: mockDb }));

const requireActiveAuth = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireActiveAuth }));

const getInstallation = vi.fn();
const getOrRefreshAccessToken = vi.fn();
const listInstallationRepos = vi.fn();
vi.mock("~/lib/github.server", () => ({
  getInstallation,
  getOrRefreshAccessToken,
  listInstallationRepos,
}));

const getAIProviderConfig = vi.fn();
vi.mock("~/lib/ai-provider.server", () => ({ getAIProviderConfig }));

const isSaasMock = vi.fn();
vi.mock("~/lib/appMode.server", () => ({ isSaas: () => isSaasMock() }));

vi.mock("~/lib/clone.server", () => ({ cloneRepository: vi.fn() }));
vi.mock("~/lib/projects.server", () => ({ addRepoToProject: vi.fn() }));
vi.mock("~/lib/e2b/sandbox-manager.server", () => ({ getOrCreateSandbox: vi.fn() }));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _op: "eq", args }),
}));

vi.mock("~/lib/db/schema", () => ({
  repositories: {},
  organizations: {},
  projects: {},
  projectRepositories: {},
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
  return new Request("http://localhost/onboarding/project", { method: "GET" });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  requireActiveAuth.mockResolvedValue(mockUser());
  getAIProviderConfig.mockResolvedValue({ provider: "anthropic" });
  getInstallation.mockResolvedValue(null);
  getOrRefreshAccessToken.mockResolvedValue("test-token");
  listInstallationRepos.mockResolvedValue([]);
  mockDb._setSelectResult([]);
  isSaasMock.mockReturnValue(true);
});

describe("onboarding.project loader", () => {
  async function callLoader(request: Request) {
    const mod = await import("./onboarding.project");
    return mod.loader({ request } as never);
  }

  it("redirects to /onboarding/github in SaaS mode when installation is null and no repos exist", async () => {
    isSaasMock.mockReturnValue(true);
    getInstallation.mockResolvedValue(null);
    mockDb._setSelectResult([]);

    const response = await callLoader(buildLoaderRequest());

    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get("location")).toBe("/onboarding/github");
  });

  it("redirects to /onboarding/github in SaaS mode when installation is pending and no repos exist", async () => {
    isSaasMock.mockReturnValue(true);
    getInstallation.mockResolvedValue({ status: "pending" });
    mockDb._setSelectResult([]);

    const response = await callLoader(buildLoaderRequest());

    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get("location")).toBe("/onboarding/github");
  });

  it("does NOT redirect in SaaS mode when installation is null but org has existing repos (public repo path)", async () => {
    isSaasMock.mockReturnValue(true);
    getInstallation.mockResolvedValue(null);
    const existingRepo = { id: "repo-1", name: "fizzy", fullName: "basecamp/fizzy" };
    mockDb._selectResults = [[existingRepo], [existingRepo]];

    const response = await callLoader(buildLoaderRequest());

    expect(response).not.toBeInstanceOf(Response);
    expect(response).toMatchObject({ hasInstallation: false, existingRepos: [existingRepo] });
  });

  it("does NOT redirect in SaaS mode when installation is pending but org has existing repos (public repo path)", async () => {
    isSaasMock.mockReturnValue(true);
    getInstallation.mockResolvedValue({ status: "pending" });
    const existingRepo = { id: "repo-1", name: "fizzy", fullName: "basecamp/fizzy" };
    mockDb._selectResults = [[existingRepo], [existingRepo]];

    const response = await callLoader(buildLoaderRequest());

    expect(response).not.toBeInstanceOf(Response);
    expect(response).toMatchObject({ hasInstallation: true, existingRepos: [existingRepo] });
  });

  it("does NOT redirect when installation is active in SaaS mode", async () => {
    isSaasMock.mockReturnValue(true);
    getInstallation.mockResolvedValue({ status: "active", installationId: "123", accessToken: "tok", expiresAt: new Date() });

    const response = await callLoader(buildLoaderRequest());

    expect(response).not.toBeInstanceOf(Response);
    expect(response).toMatchObject({ availableRepos: [], hasInstallation: true });
  });

  it("does NOT redirect in self-hosted mode regardless of installation status", async () => {
    isSaasMock.mockReturnValue(false);
    getInstallation.mockResolvedValue(null);

    const response = await callLoader(buildLoaderRequest());

    expect(response).not.toBeInstanceOf(Response);
    expect(response).toMatchObject({ hasInstallation: false });
  });
});
