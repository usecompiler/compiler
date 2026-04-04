import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { createMockDb } from "~/test-utils/mock-db";

const mockDb = createMockDb();
vi.mock("~/lib/db/index.server", () => ({ db: mockDb }));

const verifyWebhookSignature = vi.fn();
const completePendingInstallation = vi.fn();
vi.mock("~/lib/github.server", () => ({
  verifyWebhookSignature,
  completePendingInstallation,
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _op: "eq", args }),
}));

vi.mock("~/lib/db/schema", () => ({
  githubInstallations: { installationId: "githubInstallations.installationId" },
}));

function signPayload(payload: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function buildWebhookRequest(
  event: string,
  payload: object,
  { signature, secret = "test-secret" }: { signature?: string; secret?: string } = {}
) {
  const body = JSON.stringify(payload);
  const sig = signature ?? signPayload(body, secret);

  return new Request("http://localhost/api/github/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": event,
      "X-Hub-Signature-256": sig,
    },
    body,
  });
}

async function callAction(request: Request) {
  const { action } = await import("./api.github.webhooks");
  return action({ request } as never);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
  verifyWebhookSignature.mockReturnValue(true);
  completePendingInstallation.mockResolvedValue(false);
  mockDb._deleteWhere.mockResolvedValue(undefined);
});

describe("api.github.webhooks", () => {
  it("returns 405 for non-POST", async () => {
    const request = new Request("http://localhost/api/github/webhooks", { method: "GET" });
    const response = await callAction(request);
    expect(response.status).toBe(405);
  });

  it("returns 401 when signature is missing", async () => {
    const request = new Request("http://localhost/api/github/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Event": "installation" },
      body: "{}",
    });
    const response = await callAction(request);
    expect(response.status).toBe(401);
  });

  it("returns 401 when signature is invalid", async () => {
    verifyWebhookSignature.mockReturnValue(false);
    const request = buildWebhookRequest("installation", { action: "created" }, { signature: "sha256=invalid" });
    const response = await callAction(request);
    expect(response.status).toBe(401);
  });

  it("calls completePendingInstallation on installation.created", async () => {
    completePendingInstallation.mockResolvedValue(true);
    const payload = {
      action: "created",
      installation: { id: 12345, account: { login: "myorg" } },
    };
    const request = buildWebhookRequest("installation", payload);
    const response = await callAction(request);

    expect(response.status).toBe(200);
    expect(completePendingInstallation).toHaveBeenCalledWith("myorg", "12345");
  });

  it("deletes installation on installation.deleted", async () => {
    const payload = {
      action: "deleted",
      installation: { id: 99999, account: { login: "myorg" } },
    };
    const request = buildWebhookRequest("installation", payload);
    const response = await callAction(request);

    expect(response.status).toBe(200);
    expect(mockDb.delete).toHaveBeenCalled();
    const whereArg = mockDb._deleteWhere.mock.calls[0][0];
    expect(whereArg).toEqual({ _op: "eq", args: ["githubInstallations.installationId", "99999"] });
  });

  it("returns 200 for unhandled events", async () => {
    const request = buildWebhookRequest("push", { ref: "refs/heads/main" });
    const response = await callAction(request);
    expect(response.status).toBe(200);
    expect(completePendingInstallation).not.toHaveBeenCalled();
  });
});
