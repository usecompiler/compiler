import { describe, it, expect, vi, beforeEach } from "vitest";

const requireActiveAuth = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireActiveAuth }));

const getInstallationAccessToken = vi.fn();
const saveInstallation = vi.fn();
vi.mock("~/lib/github.server", () => ({ getInstallationAccessToken, saveInstallation }));

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

function buildCallbackUrl(params: Record<string, string> = {}): string {
  const url = new URL("http://localhost/onboarding/github-callback");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function expectRedirect(result: unknown, location: string) {
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(302);
  expect((result as Response).headers.get("Location")).toBe(location);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActiveAuth.mockResolvedValue(mockUser());
  getInstallationAccessToken.mockResolvedValue({ token: "ghs_token123", expiresAt: new Date("2026-03-01T00:00:00Z") });
  saveInstallation.mockResolvedValue(undefined);
});

describe("onboarding.github-callback loader", () => {
  async function callLoader(url: string) {
    const { loader } = await import("./onboarding.github-callback");
    return loader({ request: new Request(url) } as never);
  }

  it("redirects to / when no organization", async () => {
    requireActiveAuth.mockResolvedValue(mockUser({ organization: null }));
    const result = await callLoader(buildCallbackUrl({ installation_id: "123", setup_action: "install" }));
    expectRedirect(result, "/");
  });

  it("redirects to / when role is not owner", async () => {
    requireActiveAuth.mockResolvedValue(
      mockUser({ membership: { id: "member-1", organizationId: "org-1", role: "member", isDeactivated: false } })
    );
    const result = await callLoader(buildCallbackUrl({ installation_id: "123", setup_action: "install" }));
    expectRedirect(result, "/");
  });

  it("redirects with error when installation_id missing", async () => {
    const result = await callLoader(buildCallbackUrl({ setup_action: "install" }));
    expectRedirect(result, "/onboarding/github?error=missing_installation_id");
  });

  it("calls getInstallationAccessToken + saveInstallation for setup_action install", async () => {
    await callLoader(buildCallbackUrl({ installation_id: "456", setup_action: "install" }));
    expect(getInstallationAccessToken).toHaveBeenCalledWith("org-1", "456");
    expect(saveInstallation).toHaveBeenCalledWith("org-1", "456", "ghs_token123", expect.any(Date));
  });

  it("calls getInstallationAccessToken + saveInstallation for setup_action update", async () => {
    await callLoader(buildCallbackUrl({ installation_id: "789", setup_action: "update" }));
    expect(getInstallationAccessToken).toHaveBeenCalledWith("org-1", "789");
    expect(saveInstallation).toHaveBeenCalledWith("org-1", "789", "ghs_token123", expect.any(Date));
  });

  it("does NOT call getInstallationAccessToken for unrecognized setup_action", async () => {
    await callLoader(buildCallbackUrl({ installation_id: "123", setup_action: "unknown" }));
    expect(getInstallationAccessToken).not.toHaveBeenCalled();
    expect(saveInstallation).not.toHaveBeenCalled();
  });

  it("redirects to /settings/github?showAdd=true when already onboarded", async () => {
    requireActiveAuth.mockResolvedValue(
      mockUser({ organization: { id: "org-1", onboardingCompleted: true, createdAt: new Date() } })
    );
    const result = await callLoader(buildCallbackUrl({ installation_id: "123", setup_action: "install" }));
    expectRedirect(result, "/settings/github?showAdd=true");
  });

  it("redirects to /projects/new/{id}/repos when state matches project:{id}", async () => {
    const result = await callLoader(buildCallbackUrl({ installation_id: "123", setup_action: "install", state: "project:proj-42" }));
    expectRedirect(result, "/projects/new/proj-42/repos");
  });

  it("redirects to /onboarding/repos as default fallback", async () => {
    const result = await callLoader(buildCallbackUrl({ installation_id: "123", setup_action: "install" }));
    expectRedirect(result, "/onboarding/repos");
  });
});
