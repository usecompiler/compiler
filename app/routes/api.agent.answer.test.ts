import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, buildRequest } from "~/test-utils/mock-db";

const mockDb = createMockDb();

vi.mock("~/lib/db/index.server", () => ({ db: mockDb }));

const requireActiveAuth = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireActiveAuth }));

const submitAnswer = vi.fn();
vi.mock("~/lib/agent.server", () => ({ submitAnswer }));

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

function validBody() {
  return {
    conversationId: "conv-1",
    answers: { "Pick one": "Option A" },
  };
}

async function callAction(request: Request) {
  const { action } = await import("./api.agent.answer");
  return action({ request } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb._selectCallCount = 0;
  mockDb._selectResults = [[]];
  mockDb._insertValues.mockResolvedValue(undefined);
  mockDb._updateSet.mockClear();
  mockDb._updateWhere.mockResolvedValue(undefined);

  requireActiveAuth.mockResolvedValue(mockUser());
  submitAnswer.mockReturnValue(true);
  mockDb._setSelectResult([{ id: "conv-1" }]);
});

describe("api.agent.answer action", () => {
  it("returns 405 for non-POST method", async () => {
    const request = buildRequest({}, "GET");
    const response = await callAction(request);
    expect(response.status).toBe(405);
  });

  it("returns 403 when user has no organization", async () => {
    requireActiveAuth.mockResolvedValue(mockUser({ organization: null }));
    const request = buildRequest(validBody());
    const response = await callAction(request);
    expect(response.status).toBe(403);
  });

  it("returns 400 when conversationId is missing", async () => {
    const request = buildRequest({ answers: { q: "a" } });
    const response = await callAction(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 when answers is missing", async () => {
    const request = buildRequest({ conversationId: "conv-1" });
    const response = await callAction(request);
    expect(response.status).toBe(400);
  });

  it("returns 404 when conversation is not found", async () => {
    mockDb._setSelectResult([]);
    const request = buildRequest(validBody());
    const response = await callAction(request);
    expect(response.status).toBe(404);
  });

  it("returns 404 when no pending question exists", async () => {
    submitAnswer.mockReturnValue(false);
    const request = buildRequest(validBody());
    const response = await callAction(request);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("No pending question");
  });

  it("returns success when answer is submitted", async () => {
    const body = validBody();
    const request = buildRequest(body);
    const response = await callAction(request);
    const json = await response.json();

    expect(json).toEqual({ success: true });
    expect(submitAnswer).toHaveBeenCalledWith("conv-1", { "Pick one": "Option A" });
  });
});
