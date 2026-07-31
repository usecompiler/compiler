import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, buildRequest } from "~/test-utils/mock-db";

const mockDb = createMockDb();

vi.mock("~/lib/db/index.server", () => ({ db: mockDb }));

const requireActiveAuth = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireActiveAuth }));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _op: "eq", args }),
  and: (...args: unknown[]) => ({ _op: "and", args }),
}));

vi.mock("ai", () => ({
  UI_MESSAGE_STREAM_HEADERS: { "content-type": "text/event-stream" },
}));

const mockGetActiveStream = vi.fn();
const mockResumeExistingStream = vi.fn();
const mockRequestStop = vi.fn().mockResolvedValue(undefined);
vi.mock("~/lib/resumable.server", () => ({
  getActiveStream: (...args: unknown[]) => mockGetActiveStream(...args),
  getStreamContext: () => ({ resumeExistingStream: mockResumeExistingStream }),
  requestStop: (...args: unknown[]) => mockRequestStop(...args),
}));

function mockUser() {
  return {
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    organization: { id: "org-1" },
    membership: { id: "member-1" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb._selectCallCount = 0;
  requireActiveAuth.mockResolvedValue(mockUser());
  mockRequestStop.mockResolvedValue(undefined);
  mockDb._setSelectResult([{ id: "conv-1" }]);
});

async function callStreamLoader(conversationId = "conv-1") {
  const { loader } = await import("./api.agent.$conversationId.stream");
  return loader({
    request: buildRequest({}, "GET"),
    params: { conversationId },
  } as never);
}

async function callStopAction(method = "POST", conversationId = "conv-1") {
  const { action } = await import("./api.agent.$conversationId.stop");
  return action({
    request: buildRequest({}, method),
    params: { conversationId },
  } as never);
}

describe("api.agent.$conversationId.stream loader", () => {
  it("returns 204 when the conversation does not exist or is not owned", async () => {
    mockDb._setSelectResult([]);
    const response = await callStreamLoader();
    expect(response.status).toBe(204);
    expect(mockGetActiveStream).not.toHaveBeenCalled();
  });

  it("returns 204 when there is no active stream", async () => {
    mockGetActiveStream.mockResolvedValue(null);
    const response = await callStreamLoader();
    expect(response.status).toBe(204);
  });

  it("returns 204 when the active stream has already finished", async () => {
    mockGetActiveStream.mockResolvedValue("stream-1");
    mockResumeExistingStream.mockResolvedValue(null);
    const response = await callStreamLoader();
    expect(response.status).toBe(204);
  });

  it("resumes an active stream with UI message stream headers", async () => {
    mockGetActiveStream.mockResolvedValue("stream-1");
    mockResumeExistingStream.mockResolvedValue(new ReadableStream());
    const response = await callStreamLoader();
    expect(response.status).toBe(200);
    expect(mockResumeExistingStream).toHaveBeenCalledWith("stream-1");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });
});

describe("api.agent.$conversationId.stop action", () => {
  it("rejects non-POST methods", async () => {
    const response = await callStopAction("DELETE");
    expect(response.status).toBe(405);
  });

  it("returns 404 when the conversation is not owned by the user", async () => {
    mockDb._setSelectResult([]);
    const response = await callStopAction();
    expect(response.status).toBe(404);
    expect(mockRequestStop).not.toHaveBeenCalled();
  });

  it("requests a stop for the owner's conversation", async () => {
    const response = await callStopAction();
    expect(response.status).toBe(204);
    expect(mockRequestStop).toHaveBeenCalledWith("conv-1");
  });
});
