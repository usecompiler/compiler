import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { createMockDb } from "~/test-utils/mock-db";

const mockDb = createMockDb();
vi.mock("~/lib/db/index.server", () => ({ db: mockDb }));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _op: "eq", args }),
}));

vi.mock("~/lib/db/schema", () => ({
  githubInstallations: {
    organizationId: "githubInstallations.organizationId",
    installationId: "githubInstallations.installationId",
    encryptedAccessToken: "githubInstallations.encryptedAccessToken",
    accessTokenIv: "githubInstallations.accessTokenIv",
    githubAccountLogin: "githubInstallations.githubAccountLogin",
  },
  githubAppConfigurations: {},
}));

vi.mock("~/lib/encryption.server", () => ({
  encrypt: (val: string) => ({ ciphertext: `enc_${val}`, iv: "test_iv" }),
  decrypt: (val: string) => val.replace("enc_", ""),
}));

vi.mock("~/lib/appMode.server", () => ({
  isSaas: () => false,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockDb._selectCallCount = 0;
  mockDb._selectResults = [[]];
});

describe("verifyWebhookSignature", () => {
  it("returns true for valid signature", async () => {
    const { verifyWebhookSignature } = await import("./github.server");
    const payload = '{"action":"created"}';
    const secret = "my-secret";
    const signature = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");

    expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
  });

  it("returns false for invalid signature", async () => {
    const { verifyWebhookSignature } = await import("./github.server");
    expect(verifyWebhookSignature("payload", "sha256=bad", "secret")).toBe(false);
  });

  it("returns false for mismatched length signatures", async () => {
    const { verifyWebhookSignature } = await import("./github.server");
    expect(verifyWebhookSignature("payload", "sha256=short", "secret")).toBe(false);
  });
});

describe("getInstallation", () => {
  it("returns null when no row exists", async () => {
    mockDb._selectResults = [[]];
    const { getInstallation } = await import("./github.server");
    const result = await getInstallation("org-1");
    expect(result).toBeNull();
  });

  it("returns pending when installationId is null", async () => {
    mockDb._selectResults = [[{
      organizationId: "org-1",
      installationId: null,
      githubAccountLogin: "myorg",
      encryptedAccessToken: null,
      accessTokenIv: null,
      accessTokenExpiresAt: null,
    }]];
    const { getInstallation } = await import("./github.server");
    const result = await getInstallation("org-1");
    expect(result).toEqual({ status: "pending" });
  });

  it("returns active with decrypted token when installation is complete", async () => {
    const expiresAt = new Date("2026-12-31");
    mockDb._selectResults = [[{
      organizationId: "org-1",
      installationId: "12345",
      githubAccountLogin: "myorg",
      encryptedAccessToken: "enc_ghtoken",
      accessTokenIv: "test_iv",
      accessTokenExpiresAt: expiresAt,
    }]];
    const { getInstallation } = await import("./github.server");
    const result = await getInstallation("org-1");
    expect(result).toEqual({
      status: "active",
      installationId: "12345",
      accessToken: "ghtoken",
      expiresAt,
    });
  });

  it("returns pending when token fields are missing", async () => {
    mockDb._selectResults = [[{
      organizationId: "org-1",
      installationId: "12345",
      githubAccountLogin: "myorg",
      encryptedAccessToken: null,
      accessTokenIv: null,
      accessTokenExpiresAt: null,
    }]];
    const { getInstallation } = await import("./github.server");
    const result = await getInstallation("org-1");
    expect(result).toEqual({ status: "pending" });
  });
});
