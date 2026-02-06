import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, buildRequest, } from "~/test-utils/mock-db";

const mockDb = createMockDb();

vi.mock("~/lib/db/index.server", () => ({ db: mockDb }));

const requireAuth = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireAuth }));

const getConversationByShareToken = vi.fn();
const isUserInOrg = vi.fn();
const markReviewRequestAsReviewed = vi.fn().mockResolvedValue(undefined);
vi.mock("~/lib/conversations.server", () => ({
  getConversationByShareToken,
  isUserInOrg,
  markReviewRequestAsReviewed,
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

function validBody() {
  return {
    conversationId: "conv-1",
    item: {
      id: "item-1",
      type: "message",
      role: "user",
      content: { text: "Hello" },
      status: "completed",
      createdAt: Date.now(),
    },
  };
}

async function callAction(request: Request) {
  const { action } = await import("./api.items");
  return action({ request } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb._selectCallCount = 0;
  mockDb._selectResults = [[]];
  mockDb._insertValues.mockResolvedValue(undefined);
  mockDb._updateSet.mockClear();
  mockDb._updateWhere.mockResolvedValue(undefined);

  requireAuth.mockResolvedValue(mockUser());
  mockDb._setSelectResult([{ id: "conv-1", title: "Test Chat", userId: "user-1" }]);
});

describe("api.items action", () => {
  it("returns 405 for non-POST method", async () => {
    const request = buildRequest({}, "GET");
    const response = await callAction(request);
    expect(response.status).toBe(405);
  });

  it("returns 400 when conversationId or item is missing", async () => {
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

  it("inserts item for conversation owner", async () => {
    const body = validBody();
    const request = buildRequest(body);
    const response = await callAction(request);
    const json = await response.json();

    expect(json).toEqual({ success: true });
    expect(mockDb._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: body.item.id,
        conversationId: body.conversationId,
        type: body.item.type,
        role: body.item.role,
      })
    );
  });

  it("share token fallback works for review items", async () => {
    mockDb._selectResults = [
      [],
      [{ id: "conv-1", title: "Test Chat", userId: "other-user" }],
    ];
    mockDb._selectCallCount = 0;

    getConversationByShareToken.mockResolvedValue({
      conversation: { id: "conv-1", userId: "other-user", title: "Test Chat" },
      organizationId: "org-1",
      ownerName: "Other User",
    });
    isUserInOrg.mockResolvedValue(true);

    const body = {
      conversationId: "conv-1",
      shareToken: "share-token-123",
      item: {
        id: "item-review-1",
        type: "review",
        role: "user",
        content: { text: "Looks good" },
        status: "completed",
        createdAt: Date.now(),
      },
    };
    const request = buildRequest(body);
    const response = await callAction(request);
    const json = await response.json();

    expect(json).toEqual({ success: true });
    expect(mockDb._insertValues).toHaveBeenCalled();
  });

  it("share token rejected when user not in org", async () => {
    mockDb._selectResults = [[], []];
    mockDb._selectCallCount = 0;

    getConversationByShareToken.mockResolvedValue({
      conversation: { id: "conv-1", userId: "other-user", title: "Test Chat" },
      organizationId: "org-1",
      ownerName: "Other User",
    });
    isUserInOrg.mockResolvedValue(false);

    const body = {
      conversationId: "conv-1",
      shareToken: "share-token-123",
      item: {
        id: "item-review-1",
        type: "review",
        role: "user",
        content: { text: "Review" },
        status: "completed",
        createdAt: Date.now(),
      },
    };
    const request = buildRequest(body);
    const response = await callAction(request);
    expect(response.status).toBe(404);
  });

  it("review items trigger markReviewRequestAsReviewed", async () => {
    const body = {
      ...validBody(),
      item: { ...validBody().item, type: "review" },
    };
    const request = buildRequest(body);
    await callAction(request);

    expect(markReviewRequestAsReviewed).toHaveBeenCalledWith("conv-1", "user-1");
  });

  it("non-review items skip markReviewRequestAsReviewed", async () => {
    const request = buildRequest(validBody());
    await callAction(request);

    expect(markReviewRequestAsReviewed).not.toHaveBeenCalled();
  });

  it("conversation updatedAt is refreshed", async () => {
    const request = buildRequest(validBody());
    await callAction(request);

    const setCalls = mockDb._updateSet.mock.calls;
    const updateCall = setCalls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).updatedAt instanceof Date
    );
    expect(updateCall).toBeDefined();
  });
});
