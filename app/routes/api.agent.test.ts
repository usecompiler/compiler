import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, buildRequest, consumeSSEStream } from "~/test-utils/mock-db";
import type { AgentEvent } from "~/lib/agent.server";

const mockDb = createMockDb();

vi.mock("~/lib/db/index.server", () => ({ db: mockDb }));

const requireActiveAuth = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireActiveAuth }));

const runAgent = vi.fn();
vi.mock("~/lib/agent.server", () => ({ runAgent }));

const syncStaleRepos = vi.fn().mockResolvedValue(undefined);
vi.mock("~/lib/clone.server", () => ({ syncStaleRepos }));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _op: "eq", args }),
  and: (...args: unknown[]) => ({ _op: "and", args }),
  asc: (...args: unknown[]) => ({ _op: "asc", args }),
  inArray: (...args: unknown[]) => ({ _op: "inArray", args }),
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
    prompt: "Hello",
    conversationId: "conv-1",
    userItem: {
      id: "item-user-1",
      type: "message",
      role: "user",
      content: { text: "Hello" },
      status: "completed",
      createdAt: Date.now(),
    },
    assistantItemId: "item-assistant-1",
  };
}

async function* mockAgentStream(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) {
    yield event;
  }
}

async function callAction(request: Request) {
  const { action } = await import("./api.agent");
  return action({ request } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb._selectCallCount = 0;
  mockDb._selectResults = [[]];
  mockDb._insertValues.mockImplementation(() => {
    const p = Promise.resolve(undefined);
    (p as unknown as Record<string, unknown>).onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    return p;
  });
  mockDb._updateSet.mockClear();
  mockDb._updateWhere.mockResolvedValue(undefined);

  requireActiveAuth.mockResolvedValue(mockUser());
  runAgent.mockReturnValue(mockAgentStream([]));
  mockDb._setSelectResult([{ id: "conv-1", title: "Existing Chat", userId: "user-1", sessionId: null }]);
});

describe("api.agent action", () => {
  describe("validation & guards", () => {
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

    it("returns 400 when prompt is missing", async () => {
      const body = { ...validBody(), prompt: "" };
      const request = buildRequest(body);
      const response = await callAction(request);
      expect(response.status).toBe(400);
    });

    it("returns 400 when conversationId, userItem, or assistantItemId is missing", async () => {
      const body = { prompt: "Hello" };
      const request = buildRequest(body);
      const response = await callAction(request);
      expect(response.status).toBe(400);
    });

    it("returns 403 when user has no membership", async () => {
      requireActiveAuth.mockResolvedValue(mockUser({ membership: null }));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Member not found");
    });

    it("returns 404 when conversation is not found", async () => {
      mockDb._setSelectResult([]);
      const request = buildRequest(validBody());
      const response = await callAction(request);
      expect(response.status).toBe(404);
    });
  });

  describe("DB persistence", () => {
    it("inserts user item into DB before streaming", async () => {
      runAgent.mockReturnValue(mockAgentStream([{ type: "result", stats: { toolUses: 0, tokens: 10, durationMs: 100 } }]));
      const body = validBody();
      const request = buildRequest(body);
      const response = await callAction(request);
      await consumeSSEStream(response);

      const insertCalls = mockDb._insertValues.mock.calls;
      expect(insertCalls[0][0]).toMatchObject({
        id: body.userItem.id,
        conversationId: body.conversationId,
        type: body.userItem.type,
        role: body.userItem.role,
      });
    });

    it("inserts empty assistant item into DB before streaming", async () => {
      runAgent.mockReturnValue(mockAgentStream([{ type: "result", stats: { toolUses: 0, tokens: 10, durationMs: 100 } }]));
      const body = validBody();
      const request = buildRequest(body);
      const response = await callAction(request);
      await consumeSSEStream(response);

      const insertCalls = mockDb._insertValues.mock.calls;
      expect(insertCalls[1][0]).toMatchObject({
        id: body.assistantItemId,
        conversationId: body.conversationId,
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: { text: "", toolCalls: [], stats: null },
      });
    });

    it("updates title to prompt text when conversation title is 'New Chat'", async () => {
      mockDb._setSelectResult([{ id: "conv-1", title: "New Chat", userId: "user-1", sessionId: null }]);
      runAgent.mockReturnValue(mockAgentStream([{ type: "result", stats: { toolUses: 0, tokens: 10, durationMs: 100 } }]));
      const body = validBody();
      body.userItem.content = { text: "My question" };
      const request = buildRequest(body);
      const response = await callAction(request);
      await consumeSSEStream(response);

      const setCalls = mockDb._updateSet.mock.calls;
      const titleUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).title !== undefined);
      expect(titleUpdate).toBeDefined();
      expect((titleUpdate![0] as Record<string, string>).title).toBe("My question");
    });

    it("does NOT change title when already set", async () => {
      mockDb._setSelectResult([{ id: "conv-1", title: "Existing Title", userId: "user-1", sessionId: null }]);
      runAgent.mockReturnValue(mockAgentStream([{ type: "result", stats: { toolUses: 0, tokens: 10, durationMs: 100 } }]));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      const preStreamSetCalls = mockDb._updateSet.mock.calls;
      const titleUpdate = preStreamSetCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).title !== undefined);
      expect(titleUpdate).toBeUndefined();
    });

    it("on stream completion, updates assistant item with final content and status 'completed'", async () => {
      const events: AgentEvent[] = [
        { type: "text", content: "Hello world" },
        { type: "result", stats: { toolUses: 0, tokens: 50, durationMs: 200 } },
      ];
      runAgent.mockReturnValue(mockAgentStream(events));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      const setCalls = mockDb._updateSet.mock.calls;
      const finalUpdate = setCalls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).status === "completed"
      );
      expect(finalUpdate).toBeDefined();
      expect((finalUpdate![0] as Record<string, unknown>).content).toMatchObject({
        text: "Hello world",
        toolCalls: [],
        stats: { toolUses: 0, tokens: 50, durationMs: 200 },
      });
    });

    it("on stream error, updates assistant item with status 'cancelled'", async () => {
      async function* errorStream(): AsyncGenerator<AgentEvent> {
        yield { type: "text", content: "partial" };
        throw new Error("Stream failed");
      }
      runAgent.mockReturnValue(errorStream());
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      const setCalls = mockDb._updateSet.mock.calls;
      const cancelUpdate = setCalls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).status === "cancelled"
      );
      expect(cancelUpdate).toBeDefined();
    });
  });

  describe("session resumption", () => {
    it("passes sessionId to runAgent when present", async () => {
      mockDb._setSelectResult([{ id: "conv-1", title: "Existing Chat", userId: "user-1", sessionId: "sdk-session-123" }]);
      runAgent.mockReturnValue(mockAgentStream([{ type: "result", stats: { toolUses: 0, tokens: 10, durationMs: 100 } }]));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      expect(runAgent).toHaveBeenCalledWith(
        "Hello",
        "org-1",
        "member-1",
        "conv-1",
        "sdk-session-123",
        expect.anything(),
        undefined,
        null,
      );
    });

    it("passes null sessionId to runAgent for new conversations", async () => {
      runAgent.mockReturnValue(mockAgentStream([{ type: "result", stats: { toolUses: 0, tokens: 10, durationMs: 100 } }]));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      expect(runAgent).toHaveBeenCalledWith(
        "Hello",
        "org-1",
        "member-1",
        "conv-1",
        null,
        expect.anything(),
        undefined,
        null,
      );
    });

    it("prepends text history when sessionId is null and prior messages exist", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1", sessionId: null }],
        [
          { role: "user", content: "What does this project do?" },
          { role: "assistant", content: { text: "It manages widgets." } },
        ],
      ];
      mockDb._selectCallCount = 0;
      runAgent.mockReturnValue(mockAgentStream([{ type: "result", stats: { toolUses: 0, tokens: 10, durationMs: 100 } }]));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      const promptArg = runAgent.mock.calls[0][0];
      expect(promptArg).toContain("User: What does this project do?");
      expect(promptArg).toContain("Assistant: It manages widgets.");
      expect(promptArg).toContain("User: Hello");
    });

    it("skips history fallback when sessionId is present", async () => {
      mockDb._setSelectResult([{ id: "conv-1", title: "Existing Chat", userId: "user-1", sessionId: "existing-session" }]);
      runAgent.mockReturnValue(mockAgentStream([{ type: "result", stats: { toolUses: 0, tokens: 10, durationMs: 100 } }]));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      expect(runAgent.mock.calls[0][0]).toBe("Hello");
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });

    it("persists session_id from session_init event", async () => {
      const events: AgentEvent[] = [
        { type: "session_init", sessionId: "new-sdk-session-456" },
        { type: "text", content: "Hello" },
        { type: "result", stats: { toolUses: 0, tokens: 10, durationMs: 100 } },
      ];
      runAgent.mockReturnValue(mockAgentStream(events));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      const setCalls = mockDb._updateSet.mock.calls;
      const sessionUpdate = setCalls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).sessionId !== undefined
      );
      expect(sessionUpdate).toBeDefined();
      expect((sessionUpdate![0] as Record<string, string>).sessionId).toBe("new-sdk-session-456");
    });
  });

  describe("stream accumulation", () => {
    it("accumulates multiple text events", async () => {
      const events: AgentEvent[] = [
        { type: "text", content: "Hello " },
        { type: "text", content: "world" },
        { type: "result", stats: { toolUses: 0, tokens: 20, durationMs: 100 } },
      ];
      runAgent.mockReturnValue(mockAgentStream(events));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      const setCalls = mockDb._updateSet.mock.calls;
      const finalUpdate = setCalls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).status === "completed"
      );
      expect((finalUpdate![0] as Record<string, { text: string }>).content.text).toBe("Hello world");
    });

    it("new_turn events insert double newlines into text", async () => {
      const events: AgentEvent[] = [
        { type: "text", content: "First" },
        { type: "new_turn" },
        { type: "text", content: "Second" },
        { type: "result", stats: { toolUses: 0, tokens: 20, durationMs: 100 } },
      ];
      runAgent.mockReturnValue(mockAgentStream(events));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      const setCalls = mockDb._updateSet.mock.calls;
      const finalUpdate = setCalls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).status === "completed"
      );
      expect((finalUpdate![0] as Record<string, { text: string }>).content.text).toBe("First\n\nSecond");
    });

    it("tool_use and tool_result events build toolCalls array", async () => {
      const events: AgentEvent[] = [
        { type: "text", content: "Let me check" },
        { type: "tool_use", tool: "Bash", input: { command: "ls" } },
        { type: "tool_result", content: "file1.txt" },
        { type: "result", stats: { toolUses: 1, tokens: 30, durationMs: 150 } },
      ];
      runAgent.mockReturnValue(mockAgentStream(events));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      const setCalls = mockDb._updateSet.mock.calls;
      const finalUpdate = setCalls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).status === "completed"
      );
      const content = (finalUpdate![0] as Record<string, { toolCalls: unknown[]; toolsStartIndex: number }>).content;
      expect(content.toolCalls).toHaveLength(1);
      expect(content.toolCalls[0]).toMatchObject({
        tool: "Bash",
        input: { command: "ls" },
        result: "file1.txt",
      });
      expect(content.toolsStartIndex).toBe("Let me check".length);
    });

    it("SSE response has correct headers", async () => {
      runAgent.mockReturnValue(mockAgentStream([]));
      const request = buildRequest(validBody());
      const response = await callAction(request);

      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
    });

    it("SSE body contains all events as data lines", async () => {
      const events: AgentEvent[] = [
        { type: "text", content: "Hi" },
        { type: "result", stats: { toolUses: 0, tokens: 5, durationMs: 50 } },
      ];
      runAgent.mockReturnValue(mockAgentStream(events));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      const parsed = await consumeSSEStream(response);

      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toMatchObject({ type: "text", content: "Hi" });
      expect(parsed[1]).toMatchObject({ type: "result" });
    });
  });

  describe("AskUserQuestion handling", () => {
    it("excludes AskUserQuestion from toolCalls in persisted content", async () => {
      const events: AgentEvent[] = [
        { type: "text", content: "Let me ask" },
        { type: "tool_use", tool: "AskUserQuestion", input: { questions: [{ question: "Pick one" }] } },
        { type: "tool_result", content: "answered" },
        { type: "new_turn" },
        { type: "text", content: "Thanks" },
        { type: "result", stats: { toolUses: 1, tokens: 50, durationMs: 200 } },
      ];
      runAgent.mockReturnValue(mockAgentStream(events));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      const setCalls = mockDb._updateSet.mock.calls;
      const completedUpdates = setCalls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).status === "completed"
      );
      for (const update of completedUpdates) {
        const content = (update[0] as Record<string, { toolCalls: unknown[] }>).content;
        expect(content.toolCalls).toHaveLength(0);
      }
    });

    it("skips tool_result when awaiting question answer", async () => {
      const events: AgentEvent[] = [
        { type: "tool_use", tool: "AskUserQuestion", input: { questions: [] } },
        { type: "tool_result", content: "should be skipped" },
        { type: "new_turn" },
        { type: "text", content: "Response" },
        { type: "result", stats: { toolUses: 1, tokens: 30, durationMs: 100 } },
      ];
      runAgent.mockReturnValue(mockAgentStream(events));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      const setCalls = mockDb._updateSet.mock.calls;
      const allContent = setCalls
        .map((c: unknown[]) => (c[0] as Record<string, { toolCalls?: Array<{ result?: string }> }>).content)
        .filter(Boolean);
      for (const content of allContent) {
        for (const tc of content.toolCalls || []) {
          expect(tc.result).not.toBe("should be skipped");
        }
      }
    });

    it("splits assistant items on new_turn after AskUserQuestion", async () => {
      const events: AgentEvent[] = [
        { type: "text", content: "Before question" },
        { type: "tool_use", tool: "AskUserQuestion", input: { questions: [] } },
        { type: "tool_result", content: "answered" },
        { type: "new_turn" },
        { type: "text", content: "After answer" },
        { type: "result", stats: { toolUses: 1, tokens: 50, durationMs: 200 } },
      ];
      runAgent.mockReturnValue(mockAgentStream(events));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      const insertCalls = mockDb._insertValues.mock.calls;
      expect(insertCalls.length).toBe(3);
      expect(insertCalls[2][0]).toMatchObject({
        type: "message",
        role: "assistant",
        status: "in_progress",
      });

      const setCalls = mockDb._updateSet.mock.calls;
      const completedUpdates = setCalls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).status === "completed"
      );
      expect(completedUpdates.length).toBe(2);

      const firstCompleted = (completedUpdates[0][0] as Record<string, { text: string }>).content;
      expect(firstCompleted.text).toBe("Before question");

      const secondCompleted = (completedUpdates[1][0] as Record<string, { text: string }>).content;
      expect(secondCompleted.text).toBe("After answer");
    });

    it("does not split on new_turn without prior AskUserQuestion", async () => {
      const events: AgentEvent[] = [
        { type: "text", content: "First" },
        { type: "new_turn" },
        { type: "text", content: "Second" },
        { type: "result", stats: { toolUses: 0, tokens: 20, durationMs: 100 } },
      ];
      runAgent.mockReturnValue(mockAgentStream(events));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      const insertCalls = mockDb._insertValues.mock.calls;
      expect(insertCalls.length).toBe(2);
    });

    it("non-AskUserQuestion tool_use events are still tracked normally", async () => {
      const events: AgentEvent[] = [
        { type: "text", content: "Checking" },
        { type: "tool_use", tool: "AskUserQuestion", input: { questions: [] } },
        { type: "tool_result", content: "answered" },
        { type: "new_turn" },
        { type: "tool_use", tool: "Bash", input: { command: "ls" } },
        { type: "tool_result", content: "files" },
        { type: "text", content: "Done" },
        { type: "result", stats: { toolUses: 2, tokens: 40, durationMs: 300 } },
      ];
      runAgent.mockReturnValue(mockAgentStream(events));
      const request = buildRequest(validBody());
      const response = await callAction(request);
      await consumeSSEStream(response);

      const setCalls = mockDb._updateSet.mock.calls;
      const finalUpdate = setCalls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).status === "completed"
      ).pop();
      const content = (finalUpdate![0] as Record<string, { toolCalls: Array<{ tool: string }> }>).content;
      expect(content.toolCalls).toHaveLength(1);
      expect(content.toolCalls[0].tool).toBe("Bash");
    });
  });
});
