import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockDb } from "~/test-utils/mock-db";

const mockDb = createMockDb();
vi.mock("~/lib/db/index.server", () => ({ db: mockDb }));

const encrypt = vi.fn();
const decrypt = vi.fn();
vi.mock("~/lib/encryption.server", () => ({ encrypt, decrypt }));

vi.mock("~/lib/db/schema", () => ({
  githubAppConfigurations: {
    organizationId: "githubAppConfigurations.organizationId",
    appId: "githubAppConfigurations.appId",
    appSlug: "githubAppConfigurations.appSlug",
    encryptedPrivateKey: "githubAppConfigurations.encryptedPrivateKey",
    privateKeyIv: "githubAppConfigurations.privateKeyIv",
    updatedAt: "githubAppConfigurations.updatedAt",
  },
  githubInstallations: {
    organizationId: "githubInstallations.organizationId",
    installationId: "githubInstallations.installationId",
    encryptedAccessToken: "githubInstallations.encryptedAccessToken",
    accessTokenIv: "githubInstallations.accessTokenIv",
    accessTokenExpiresAt: "githubInstallations.accessTokenExpiresAt",
    updatedAt: "githubInstallations.updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _op: "eq", args }),
}));

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockDb._selectCallCount = 0;
  mockDb._selectResults = [[]];
  mockDb._insertValues.mockResolvedValue(undefined);
  mockDb._updateSet.mockClear();
  mockDb._updateWhere.mockResolvedValue(undefined);
  encrypt.mockReturnValue({ ciphertext: "encrypted", iv: "iv123" });
  decrypt.mockReturnValue("decrypted-value");

  delete (process.env as Record<string, unknown>).GITHUB_APP_ID;
  delete (process.env as Record<string, unknown>).GITHUB_APP_SLUG;
  delete (process.env as Record<string, unknown>).GITHUB_APP_PRIVATE_KEY;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("getGitHubAppConfig", () => {
  it("returns config from DB when record exists", async () => {
    mockDb._selectResults = [[{
      appId: "app-1",
      appSlug: "my-app",
      encryptedPrivateKey: "enc-key",
      privateKeyIv: "key-iv",
    }]];
    mockDb._selectCallCount = 0;
    decrypt.mockReturnValue("-----BEGIN RSA PRIVATE KEY-----\\ndata\\n-----END RSA PRIVATE KEY-----");

    const { getGitHubAppConfig } = await import("~/lib/github.server");
    const result = await getGitHubAppConfig("org-1");

    expect(result).toEqual({
      appId: "app-1",
      appSlug: "my-app",
      privateKey: "-----BEGIN RSA PRIVATE KEY-----\ndata\n-----END RSA PRIVATE KEY-----",
    });
  });

  it("decrypts private key", async () => {
    mockDb._selectResults = [[{
      appId: "app-1",
      appSlug: "my-app",
      encryptedPrivateKey: "enc-key",
      privateKeyIv: "key-iv",
    }]];
    mockDb._selectCallCount = 0;

    const { getGitHubAppConfig } = await import("~/lib/github.server");
    await getGitHubAppConfig("org-1");

    expect(decrypt).toHaveBeenCalledWith("enc-key", "key-iv");
  });

  it("normalizes \\n in private key", async () => {
    mockDb._selectResults = [[{
      appId: "app-1",
      appSlug: "my-app",
      encryptedPrivateKey: "enc",
      privateKeyIv: "iv",
    }]];
    mockDb._selectCallCount = 0;
    decrypt.mockReturnValue("line1\\nline2");

    const { getGitHubAppConfig } = await import("~/lib/github.server");
    const result = await getGitHubAppConfig("org-1");
    expect(result!.privateKey).toBe("line1\nline2");
  });

  it("falls back to env vars when no DB record", async () => {
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;
    process.env.GITHUB_APP_ID = "env-app-id";
    process.env.GITHUB_APP_SLUG = "env-app-slug";
    process.env.GITHUB_APP_PRIVATE_KEY = "env-key";

    const { getGitHubAppConfig } = await import("~/lib/github.server");
    const result = await getGitHubAppConfig("org-1");

    expect(result).toEqual({
      appId: "env-app-id",
      appSlug: "env-app-slug",
      privateKey: "env-key",
    });
  });

  it("returns null when nothing configured", async () => {
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;

    const { getGitHubAppConfig } = await import("~/lib/github.server");
    const result = await getGitHubAppConfig("org-1");
    expect(result).toBeNull();
  });
});

describe("saveGitHubAppConfig", () => {
  it("encrypts private key", async () => {
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;

    const { saveGitHubAppConfig } = await import("~/lib/github.server");
    await saveGitHubAppConfig("org-1", "app-1", "my-app", "private-key-data");

    expect(encrypt).toHaveBeenCalledWith("private-key-data");
  });

  it("inserts when new", async () => {
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;

    const { saveGitHubAppConfig } = await import("~/lib/github.server");
    await saveGitHubAppConfig("org-1", "app-1", "my-app", "private-key-data");

    expect(mockDb._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        appId: "app-1",
        appSlug: "my-app",
        encryptedPrivateKey: "encrypted",
        privateKeyIv: "iv123",
      })
    );
  });

  it("updates when existing", async () => {
    mockDb._selectResults = [[{ id: "existing" }]];
    mockDb._selectCallCount = 0;

    const { saveGitHubAppConfig } = await import("~/lib/github.server");
    await saveGitHubAppConfig("org-1", "app-1", "my-app", "private-key-data");

    expect(mockDb._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "app-1",
        appSlug: "my-app",
        encryptedPrivateKey: "encrypted",
        privateKeyIv: "iv123",
      })
    );
  });
});

describe("validateGitHubAppConfig", () => {
  it("returns valid false for invalid key", async () => {
    const { validateGitHubAppConfig } = await import("~/lib/github.server");
    const result = validateGitHubAppConfig("app-1", "not-a-valid-key");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid private key format");
  });
});

describe("getAuthenticatedCloneUrl", () => {
  it("inserts x-access-token credentials into URL", async () => {
    const { getAuthenticatedCloneUrl } = await import("~/lib/github.server");
    const result = getAuthenticatedCloneUrl("https://github.com/owner/repo.git", "ghs_abc123");
    expect(result).toBe("https://x-access-token:ghs_abc123@github.com/owner/repo.git");
  });
});

describe("saveInstallation", () => {
  it("encrypts token and inserts when new", async () => {
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;
    const expiresAt = new Date("2026-03-01T00:00:00Z");

    const { saveInstallation } = await import("~/lib/github.server");
    await saveInstallation("org-1", "inst-1", "ghs_token", expiresAt);

    expect(encrypt).toHaveBeenCalledWith("ghs_token");
    expect(mockDb._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        installationId: "inst-1",
        encryptedAccessToken: "encrypted",
        accessTokenIv: "iv123",
        accessTokenExpiresAt: expiresAt,
      })
    );
  });

  it("updates when existing", async () => {
    mockDb._selectResults = [[{ id: "existing" }]];
    mockDb._selectCallCount = 0;
    const expiresAt = new Date("2026-03-01T00:00:00Z");

    const { saveInstallation } = await import("~/lib/github.server");
    await saveInstallation("org-1", "inst-1", "ghs_token", expiresAt);

    expect(mockDb._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "inst-1",
        encryptedAccessToken: "encrypted",
        accessTokenIv: "iv123",
        accessTokenExpiresAt: expiresAt,
      })
    );
  });
});

describe("getInstallation", () => {
  it("returns null when no record", async () => {
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;

    const { getInstallation } = await import("~/lib/github.server");
    const result = await getInstallation("org-1");
    expect(result).toBeNull();
  });

  it("returns null when token missing", async () => {
    mockDb._selectResults = [[{
      installationId: "inst-1",
      encryptedAccessToken: null,
      accessTokenIv: null,
      accessTokenExpiresAt: new Date(),
    }]];
    mockDb._selectCallCount = 0;

    const { getInstallation } = await import("~/lib/github.server");
    const result = await getInstallation("org-1");
    expect(result).toBeNull();
  });

  it("decrypts and returns valid installation", async () => {
    const expiresAt = new Date("2026-03-01T00:00:00Z");
    mockDb._selectResults = [[{
      installationId: "inst-1",
      encryptedAccessToken: "enc-tok",
      accessTokenIv: "tok-iv",
      accessTokenExpiresAt: expiresAt,
    }]];
    mockDb._selectCallCount = 0;
    decrypt.mockReturnValue("ghs_decrypted_token");

    const { getInstallation } = await import("~/lib/github.server");
    const result = await getInstallation("org-1");

    expect(decrypt).toHaveBeenCalledWith("enc-tok", "tok-iv");
    expect(result).toEqual({
      installationId: "inst-1",
      accessToken: "ghs_decrypted_token",
      expiresAt,
    });
  });
});

describe("getOrRefreshAccessToken", () => {
  it("returns null when no installation", async () => {
    mockDb._selectResults = [[]];
    mockDb._selectCallCount = 0;

    const { getOrRefreshAccessToken } = await import("~/lib/github.server");
    const result = await getOrRefreshAccessToken("org-1");
    expect(result).toBeNull();
  });

  it("returns cached token when not near expiry", async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    mockDb._selectResults = [[{
      installationId: "inst-1",
      encryptedAccessToken: "enc",
      accessTokenIv: "iv",
      accessTokenExpiresAt: futureExpiry,
    }]];
    mockDb._selectCallCount = 0;
    decrypt.mockReturnValue("cached-token");

    const { getOrRefreshAccessToken } = await import("~/lib/github.server");
    const result = await getOrRefreshAccessToken("org-1");
    expect(result).toBe("cached-token");
  });
});

describe("listInstallationRepos", () => {
  it("fetches with Bearer token and maps response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        repositories: [
          { id: 1, name: "repo-1", full_name: "owner/repo-1", clone_url: "https://github.com/owner/repo-1.git", private: false, default_branch: "main" },
        ],
      }),
    });

    const { listInstallationRepos } = await import("~/lib/github.server");
    const repos = await listInstallationRepos("test-token");

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/installation/repositories"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );

    expect(repos).toEqual([{
      id: 1,
      name: "repo-1",
      fullName: "owner/repo-1",
      cloneUrl: "https://github.com/owner/repo-1.git",
      private: false,
      defaultBranch: "main",
    }]);
  });

  it("paginates when 100 results returned", async () => {
    const hundredRepos = Array.from({ length: 100 }, (_, i) => ({
      id: i, name: `repo-${i}`, full_name: `owner/repo-${i}`, clone_url: `https://github.com/owner/repo-${i}.git`, private: false, default_branch: "main",
    }));

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ repositories: hundredRepos }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ repositories: [{ id: 999, name: "last", full_name: "owner/last", clone_url: "https://github.com/owner/last.git", private: false, default_branch: "main" }] }),
      });

    const { listInstallationRepos } = await import("~/lib/github.server");
    const repos = await listInstallationRepos("test-token");

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(repos).toHaveLength(101);
  });

  it("stops when less than 100 results", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ repositories: [{ id: 1, name: "repo-1", full_name: "o/r", clone_url: "https://github.com/o/r.git", private: false, default_branch: "main" }] }),
    });

    const { listInstallationRepos } = await import("~/lib/github.server");
    await listInstallationRepos("test-token");

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("throws on non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve("error"),
    });

    const { listInstallationRepos } = await import("~/lib/github.server");
    await expect(listInstallationRepos("test-token")).rejects.toThrow("Failed to list repositories");
  });
});
