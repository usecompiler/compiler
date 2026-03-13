import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, buildRequest } from "~/test-utils/mock-db";

const mockDb = createMockDb();

vi.mock("~/lib/db/index.server", () => ({ db: mockDb }));

const requireActiveAuth = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireActiveAuth }));

const getAgentConfig = vi.fn();
vi.mock("~/lib/agent.server", () => ({ getAgentConfig }));

const getStorageConfig = vi.fn().mockResolvedValue(null);
const fetchFile = vi.fn();
vi.mock("~/lib/storage.server", () => ({
  getStorageConfig: (...args: unknown[]) => getStorageConfig(...args),
  fetchFile: (...args: unknown[]) => fetchFile(...args),
}));

const mockStreamText = vi.fn();
const mockConvertToModelMessages = vi.fn().mockResolvedValue([]);
const mockCreateUIMessageStreamResponse = vi.fn().mockImplementation(() =>
  new Response("data: test\n\n", { headers: { "Content-Type": "text/event-stream" } })
);
vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  convertToModelMessages: (...args: unknown[]) => mockConvertToModelMessages(...args),
  stepCountIs: (n: number) => ({ type: "stepCount", value: n }),
  smoothStream: () => "mock-smooth-stream",
  createUIMessageStreamResponse: (...args: unknown[]) => mockCreateUIMessageStreamResponse(...args),
}));

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
    message: {
      id: "msg-user-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    },
    conversationId: "conv-1",
  };
}

function setupMockStreamText() {
  mockStreamText.mockReturnValue({
    toUIMessageStream: vi.fn().mockReturnValue(new ReadableStream()),
    consumeStream: vi.fn().mockResolvedValue(undefined),
  });
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
  getAgentConfig.mockResolvedValue({
    model: "mock-model",
    modelId: "claude-sonnet-4-6-20260217",
    tools: {},
    systemPrompt: "test system prompt",
    compactionEnabled: true,
  });
  setupMockStreamText();
  mockDb._setSelectResult([{ id: "conv-1", title: "Existing Chat", userId: "user-1" }]);
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

    it("returns 400 when message is missing", async () => {
      const request = buildRequest({ conversationId: "conv-1" });
      const response = await callAction(request);
      expect(response.status).toBe(400);
    });

    it("returns 400 when conversationId is missing", async () => {
      const body = { message: validBody().message };
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

    it("returns 400 when message has no text and no blobIds", async () => {
      const body = {
        message: { id: "msg-1", role: "user", parts: [{ type: "text", text: "" }] },
        conversationId: "conv-1",
      };
      const request = buildRequest(body);
      const response = await callAction(request);
      expect(response.status).toBe(400);
    });
  });

  describe("DB persistence", () => {
    it("inserts user item into DB before streaming", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const body = validBody();
      const request = buildRequest(body);
      await callAction(request);

      const insertCalls = mockDb._insertValues.mock.calls;
      expect(insertCalls[0][0]).toMatchObject({
        id: body.message.id,
        conversationId: body.conversationId,
        type: "message",
        role: "user",
        content: "Hello",
      });
    });

    it("inserts empty assistant item into DB before streaming", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const body = validBody();
      const request = buildRequest(body);
      await callAction(request);

      const insertCalls = mockDb._insertValues.mock.calls;
      expect(insertCalls[2][0]).toMatchObject({
        conversationId: body.conversationId,
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: { text: "", toolCalls: [], stats: null },
      });
    });

    it("updates title to prompt text when conversation title is 'New Chat'", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "New Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const body = validBody();
      const request = buildRequest(body);
      await callAction(request);

      const setCalls = mockDb._updateSet.mock.calls;
      const titleUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).title !== undefined);
      expect(titleUpdate).toBeDefined();
      expect((titleUpdate![0] as Record<string, string>).title).toBe("Hello");
    });

    it("does NOT change title when already set", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Title", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const preStreamSetCalls = mockDb._updateSet.mock.calls;
      const titleUpdate = preStreamSetCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).title !== undefined);
      expect(titleUpdate).toBeUndefined();
    });
  });

  describe("streamText integration", () => {
    it("calls streamText with correct config", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "mock-model",
          system: "test system prompt",
          tools: {},
        })
      );
    });

    it("calls toUIMessageStream on the result", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      const response = await callAction(request);

      expect(response).toBeInstanceOf(Response);
      const result = mockStreamText.mock.results[0].value;
      expect(result.toUIMessageStream).toHaveBeenCalled();
    });

    it("calls consumeStream for guaranteed persistence", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const result = mockStreamText.mock.results[0].value;
      expect(result.consumeStream).toHaveBeenCalled();
    });

    it("converts prior items to UIMessages for convertToModelMessages", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [
          { id: "item-1", role: "user", content: "What does this project do?", status: "completed" },
          { id: "item-2", role: "assistant", content: { text: "It manages widgets." }, status: "completed" },
          { id: "item-3", role: "user", content: "Hello", status: "completed" },
        ],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      expect(mockConvertToModelMessages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: "user", parts: [{ type: "text", text: "What does this project do?" }] }),
          expect.objectContaining({ role: "assistant", parts: [{ type: "text", text: "It manages widgets." }] }),
          expect.objectContaining({ role: "user", parts: [{ type: "text", text: "Hello" }] }),
        ]),
        expect.objectContaining({ ignoreIncompleteToolCalls: true }),
      );
    });
  });

  describe("onFinish persistence callback", () => {
    it("passes onFinish to toUIMessageStream", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const result = mockStreamText.mock.results[0].value;
      const callArgs = result.toUIMessageStream.mock.calls[0][0];
      expect(callArgs).toHaveProperty("onFinish");
      expect(typeof callArgs.onFinish).toBe("function");
    });

    it("persists text and tool-call parts from assistant message", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const result = mockStreamText.mock.results[0].value;
      const callArgs = result.toUIMessageStream.mock.calls[0][0];
      await callArgs.onFinish({
        responseMessage: {
          parts: [
            { type: "text", text: "Here is the file." },
            { type: "dynamic-tool", toolName: "read", toolCallId: "tc1", input: { path: "/f" }, output: "data" },
            { type: "text", text: "Done." },
          ],
        },
      });

      const setCalls = mockDb._updateSet.mock.calls;
      const contentUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).content !== undefined);
      expect(contentUpdate).toBeDefined();
      const content = (contentUpdate![0] as Record<string, unknown>).content as Record<string, unknown>;
      const parts = content.parts as Array<Record<string, unknown>>;
      expect(parts).toHaveLength(3);
      expect(parts[0]).toMatchObject({ type: "text", text: "Here is the file." });
      expect(parts[1]).toMatchObject({ type: "tool-call", toolName: "read" });
      expect(parts[2]).toMatchObject({ type: "text", text: "Done." });
    });

    it("persists step-start parts for correct message splitting on reload", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const result = mockStreamText.mock.results[0].value;
      const callArgs = result.toUIMessageStream.mock.calls[0][0];
      await callArgs.onFinish({
        responseMessage: {
          parts: [
            { type: "text", text: "Let me check." },
            { type: "dynamic-tool", toolName: "read", toolCallId: "tc1", input: {}, output: "data" },
            { type: "step-start" },
            { type: "text", text: "Here is the result." },
          ],
        },
      });

      const setCalls = mockDb._updateSet.mock.calls;
      const contentUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).content !== undefined);
      const content = (contentUpdate![0] as Record<string, unknown>).content as Record<string, unknown>;
      const parts = content.parts as Array<Record<string, unknown>>;
      expect(parts).toHaveLength(4);
      expect(parts[0]).toMatchObject({ type: "text" });
      expect(parts[1]).toMatchObject({ type: "tool-call", toolName: "read" });
      expect(parts[2]).toMatchObject({ type: "step-start" });
      expect(parts[3]).toMatchObject({ type: "text" });
    });

    it("excludes askUserQuestion tool calls from persisted parts", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const result = mockStreamText.mock.results[0].value;
      const callArgs = result.toUIMessageStream.mock.calls[0][0];
      await callArgs.onFinish({
        responseMessage: {
          parts: [
            { type: "text", text: "What color?" },
            { type: "dynamic-tool", toolName: "askUserQuestion", toolCallId: "tc-ask", input: {}, output: "{}" },
            { type: "text", text: "Great choice." },
          ],
        },
      });

      const setCalls = mockDb._updateSet.mock.calls;
      const contentUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).content !== undefined);
      const content = (contentUpdate![0] as Record<string, unknown>).content as Record<string, unknown>;
      const parts = content.parts as Array<Record<string, unknown>>;
      expect(parts).toHaveLength(2);
      expect(parts.every((p) => p.type !== "tool-call" || p.toolName !== "askUserQuestion")).toBe(true);
    });

    it("concatenates text parts into a flat text field", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const result = mockStreamText.mock.results[0].value;
      const callArgs = result.toUIMessageStream.mock.calls[0][0];
      await callArgs.onFinish({
        responseMessage: {
          parts: [
            { type: "text", text: "First." },
            { type: "dynamic-tool", toolName: "read", toolCallId: "tc1", input: {}, output: "" },
            { type: "step-start" },
            { type: "text", text: "Second." },
          ],
        },
      });

      const setCalls = mockDb._updateSet.mock.calls;
      const contentUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).content !== undefined);
      const content = (contentUpdate![0] as Record<string, unknown>).content as Record<string, unknown>;
      expect(content.text).toBe("First.Second.");
    });

    it("sets status to completed on finish", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const result = mockStreamText.mock.results[0].value;
      const callArgs = result.toUIMessageStream.mock.calls[0][0];
      await callArgs.onFinish({
        responseMessage: { parts: [{ type: "text", text: "Done." }] },
      });

      const setCalls = mockDb._updateSet.mock.calls;
      const contentUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).status === "completed");
      expect(contentUpdate).toBeDefined();
    });
  });

  describe("tool result resubmit", () => {
    it("skips user item insert for assistant role messages", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [{ id: "item-1", role: "user", content: "Hello", status: "completed" }],
      ];
      mockDb._selectCallCount = 0;
      const body = {
        message: {
          id: "msg-assistant-1",
          role: "assistant",
          parts: [
            { type: "text", text: "Pick a color" },
            { type: "dynamic-tool", toolName: "askUserQuestion", toolCallId: "tc1", state: "output-available", input: {}, output: "{}" },
          ],
        },
        conversationId: "conv-1",
      };
      const request = buildRequest(body);
      await callAction(request);

      const insertCalls = mockDb._insertValues.mock.calls;
      const userInsert = insertCalls.find((c: unknown[]) => (c[0] as Record<string, string>).role === "user");
      expect(userInsert).toBeUndefined();
    });

    it("does not require text for assistant role resubmit", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const body = {
        message: {
          id: "msg-assistant-1",
          role: "assistant",
          parts: [{ type: "dynamic-tool", toolName: "askUserQuestion", toolCallId: "tc1", state: "output-available", input: {}, output: "{}" }],
        },
        conversationId: "conv-1",
      };
      const request = buildRequest(body);
      const response = await callAction(request);
      expect(response.status).not.toBe(400);
    });

    it("does not update conversation title for resubmit", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "New Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const body = {
        message: {
          id: "msg-assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "" }],
        },
        conversationId: "conv-1",
      };
      const request = buildRequest(body);
      await callAction(request);

      const setCalls = mockDb._updateSet.mock.calls;
      const titleUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).title !== undefined);
      expect(titleUpdate).toBeUndefined();
    });
  });

  describe("file upload (blobIds)", () => {
    it("allows empty text when blobIds are provided", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const body = {
        message: { id: "msg-1", role: "user", parts: [{ type: "text", text: "" }] },
        conversationId: "conv-1",
        blobIds: ["blob-1"],
      };
      getStorageConfig.mockResolvedValue(null);
      const request = buildRequest(body);
      const response = await callAction(request);
      expect(response.status).not.toBe(400);
    });

    it("links blobs to user item via item_blobs insert", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const body = {
        ...validBody(),
        blobIds: ["blob-1", "blob-2"],
      };
      const request = buildRequest(body);
      await callAction(request);

      const insertCalls = mockDb._insertValues.mock.calls;
      const blobInsert = insertCalls.find((c: unknown[]) => {
        const val = c[0];
        return Array.isArray(val) && val.length > 0 && (val[0] as Record<string, unknown>).blobId !== undefined;
      });
      expect(blobInsert).toBeDefined();
      const rows = blobInsert![0] as Array<Record<string, string>>;
      expect(rows).toHaveLength(2);
      expect(rows[0].itemId).toBe(body.message.id);
      expect(rows[0].blobId).toBe("blob-1");
      expect(rows[1].blobId).toBe("blob-2");
    });

    it("sets title to 'File attachment' when blobIds present with empty text on New Chat", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "New Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const body = {
        message: { id: "msg-1", role: "user", parts: [{ type: "text", text: "" }] },
        conversationId: "conv-1",
        blobIds: ["blob-1"],
      };
      getStorageConfig.mockResolvedValue(null);
      const request = buildRequest(body);
      await callAction(request);

      const setCalls = mockDb._updateSet.mock.calls;
      const titleUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).title !== undefined);
      expect(titleUpdate).toBeDefined();
      expect((titleUpdate![0] as Record<string, string>).title).toBe("File attachment");
    });

    it("fetches blob files and injects image parts into last user message", async () => {
      const imageBase64 = Buffer.from("fake-png-data").toString("base64");
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [{ id: "item-1", role: "user", content: "Describe this", status: "completed" }],
        [{ id: "blob-1", key: "files/img.png", contentType: "image/png", filename: "photo.png" }],
      ];
      mockDb._selectCallCount = 0;
      getStorageConfig.mockResolvedValue({ bucket: "test-bucket" });
      fetchFile.mockResolvedValue({ buffer: Buffer.from("fake-png-data") });

      const body = {
        ...validBody(),
        blobIds: ["blob-1"],
      };
      const request = buildRequest(body);
      await callAction(request);

      expect(fetchFile).toHaveBeenCalled();
      expect(mockConvertToModelMessages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: "file",
                mediaType: "image/png",
                url: `data:image/png;base64,${imageBase64}`,
              }),
            ]),
          }),
        ]),
        expect.anything(),
      );
    });

    it("injects PDF files as file parts", async () => {
      const pdfBase64 = Buffer.from("fake-pdf").toString("base64");
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [{ id: "item-1", role: "user", content: "Read this", status: "completed" }],
        [{ id: "blob-1", key: "files/doc.pdf", contentType: "application/pdf", filename: "doc.pdf" }],
      ];
      mockDb._selectCallCount = 0;
      getStorageConfig.mockResolvedValue({ bucket: "test-bucket" });
      fetchFile.mockResolvedValue({ buffer: Buffer.from("fake-pdf") });

      const body = { ...validBody(), blobIds: ["blob-1"] };
      const request = buildRequest(body);
      await callAction(request);

      expect(mockConvertToModelMessages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: "file",
                mediaType: "application/pdf",
                url: `data:application/pdf;base64,${pdfBase64}`,
              }),
            ]),
          }),
        ]),
        expect.anything(),
      );
    });

    it("injects text files as text parts with filename prefix", async () => {
      const textContent = "console.log('hello');";
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [{ id: "item-1", role: "user", content: "Review this", status: "completed" }],
        [{ id: "blob-1", key: "files/app.js", contentType: "application/javascript", filename: "app.js" }],
      ];
      mockDb._selectCallCount = 0;
      getStorageConfig.mockResolvedValue({ bucket: "test-bucket" });
      fetchFile.mockResolvedValue({ buffer: Buffer.from(textContent) });

      const body = { ...validBody(), blobIds: ["blob-1"] };
      const request = buildRequest(body);
      await callAction(request);

      expect(mockConvertToModelMessages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: "text",
                text: `[File: app.js]\n${textContent}`,
              }),
            ]),
          }),
        ]),
        expect.anything(),
      );
    });

    it("injects unknown file types as attachment text parts", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [{ id: "item-1", role: "user", content: "Check this", status: "completed" }],
        [{ id: "blob-1", key: "files/data.bin", contentType: "application/octet-stream", filename: "data.bin" }],
      ];
      mockDb._selectCallCount = 0;
      getStorageConfig.mockResolvedValue({ bucket: "test-bucket" });
      fetchFile.mockResolvedValue({ buffer: Buffer.from("binary") });

      const body = { ...validBody(), blobIds: ["blob-1"] };
      const request = buildRequest(body);
      await callAction(request);

      expect(mockConvertToModelMessages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: "text",
                text: "[Attached file: data.bin (application/octet-stream)]",
              }),
            ]),
          }),
        ]),
        expect.anything(),
      );
    });

    it("skips blob fetching when storage config is null", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [{ id: "item-1", role: "user", content: "Hello", status: "completed" }],
      ];
      mockDb._selectCallCount = 0;
      getStorageConfig.mockResolvedValue(null);

      const body = { ...validBody(), blobIds: ["blob-1"] };
      const request = buildRequest(body);
      await callAction(request);

      expect(fetchFile).not.toHaveBeenCalled();
    });

    it("does not fetch blobs when blobIds is empty", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const body = { ...validBody(), blobIds: [] };
      const request = buildRequest(body);
      await callAction(request);

      expect(getStorageConfig).not.toHaveBeenCalled();
      expect(fetchFile).not.toHaveBeenCalled();
    });
  });

  describe("prepareStep prompt caching", () => {
    it("passes prepareStep when promptCachingEnabled is true", async () => {
      getAgentConfig.mockResolvedValue({
        model: "mock-model",
        modelId: "claude-sonnet-4-6-20260217",
        tools: {},
        systemPrompt: "test system prompt",
        promptCachingEnabled: true,
        compactionEnabled: true,
      });
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const streamArgs = mockStreamText.mock.calls[0][0];
      expect(streamArgs.prepareStep).toBeDefined();
      expect(typeof streamArgs.prepareStep).toBe("function");
    });

    it("does not pass prepareStep when promptCachingEnabled is false", async () => {
      getAgentConfig.mockResolvedValue({
        model: "mock-model",
        modelId: "claude-sonnet-4-6-20260217",
        tools: {},
        systemPrompt: "test system prompt",
        promptCachingEnabled: false,
        compactionEnabled: true,
      });
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const streamArgs = mockStreamText.mock.calls[0][0];
      expect(streamArgs.prepareStep).toBeUndefined();
    });

    it("prepareStep adds anthropic cacheControl to last message", async () => {
      getAgentConfig.mockResolvedValue({
        model: "mock-model",
        modelId: "claude-sonnet-4-6-20260217",
        tools: {},
        systemPrompt: "test system prompt",
        promptCachingEnabled: true,
        compactionEnabled: true,
      });
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const streamArgs = mockStreamText.mock.calls[0][0];
      const stepMessages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
        { role: "user", content: "How are you?" },
      ];
      const result = streamArgs.prepareStep({ messages: stepMessages });
      expect(result.messages[0]).toEqual({ role: "user", content: "Hello" });
      expect(result.messages[1]).toEqual({ role: "assistant", content: "Hi" });
      expect(result.messages[2]).toMatchObject({
        role: "user",
        content: "How are you?",
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      });
    });

});

  describe("native compaction via contextManagement", () => {
    it("passes contextManagement providerOptions to streamText", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const streamArgs = mockStreamText.mock.calls[0][0];
      expect(streamArgs.providerOptions).toEqual({
        anthropic: {
          contextManagement: {
            edits: [
              {
                type: "clear_tool_uses_20250919",
                trigger: { type: "input_tokens", value: 30000 },
                keep: { type: "tool_uses", value: 5 },
                clearToolInputs: true,
              },
              {
                type: "compact_20260112",
                trigger: { type: "input_tokens", value: 100000 },
                instructions: undefined,
              },
            ],
          },
        },
      });
    });

    it("does not pass providerOptions when compactionEnabled is false", async () => {
      getAgentConfig.mockResolvedValue({
        model: "mock-model",
        modelId: "claude-sonnet-4-6-20260217",
        tools: {},
        systemPrompt: "test system prompt",
        compactionEnabled: false,
      });
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const streamArgs = mockStreamText.mock.calls[0][0];
      expect(streamArgs.providerOptions).toBeUndefined();
    });

    it("includes contextManagement regardless of promptCachingEnabled", async () => {
      getAgentConfig.mockResolvedValue({
        model: "mock-model",
        modelId: "claude-sonnet-4-6-20260217",
        tools: {},
        systemPrompt: "test system prompt",
        promptCachingEnabled: false,
        compactionEnabled: true,
      });
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const streamArgs = mockStreamText.mock.calls[0][0];
      expect(streamArgs.providerOptions).toEqual({
        anthropic: {
          contextManagement: {
            edits: [
              {
                type: "clear_tool_uses_20250919",
                trigger: { type: "input_tokens", value: 30000 },
                keep: { type: "tool_uses", value: 5 },
                clearToolInputs: true,
              },
              {
                type: "compact_20260112",
                trigger: { type: "input_tokens", value: 100000 },
                instructions: undefined,
              },
            ],
          },
        },
      });
    });
  });

  describe("onStepFinish token tracking", () => {
    it("does not count askUserQuestion toward toolUseCount", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const streamArgs = mockStreamText.mock.calls[0][0];
      let toolCount = 0;
      streamArgs.onStepFinish({
        usage: { inputTokens: 100, outputTokens: 50 },
        toolCalls: [
          { toolName: "read" },
          { toolName: "askUserQuestion" },
          { toolName: "glob" },
        ],
      });

      const result = mockStreamText.mock.results[0].value;
      const callArgs = result.toUIMessageStream.mock.calls[0][0];
      await callArgs.onFinish({
        responseMessage: { parts: [{ type: "text", text: "Done." }] },
      });

      const setCalls = mockDb._updateSet.mock.calls;
      const contentUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).content !== undefined);
      const content = (contentUpdate![0] as Record<string, unknown>).content as Record<string, unknown>;
      const stats = content.stats as Record<string, number>;
      expect(stats.toolUses).toBe(2);
    });
  });

  describe("onAbort callback", () => {
    it("passes onAbort to streamText", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const streamArgs = mockStreamText.mock.calls[0][0];
      expect(streamArgs.onAbort).toBeDefined();
      expect(typeof streamArgs.onAbort).toBe("function");
    });

    it("updates assistant item with status aborted and partial stats on abort", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const streamArgs = mockStreamText.mock.calls[0][0];
      await streamArgs.onAbort({
        steps: [
          {
            text: "Partial response",
            toolCalls: [
              { toolName: "read", toolCallId: "tc-1", args: { path: "/file" } },
            ],
            toolResults: [
              { toolCallId: "tc-1", result: "file content" },
            ],
            usage: { inputTokens: 200, outputTokens: 100 },
          },
          {
            text: " continued",
            toolCalls: [],
            toolResults: [],
            usage: { inputTokens: 50, outputTokens: 25 },
          },
        ],
      });

      const setCalls = mockDb._updateSet.mock.calls;
      const abortUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).status === "aborted");
      expect(abortUpdate).toBeDefined();
      const content = (abortUpdate![0] as Record<string, unknown>).content as Record<string, unknown>;
      const parts = content.parts as Array<Record<string, unknown>>;
      expect(parts).toHaveLength(3);
      expect(parts[0]).toMatchObject({ type: "text", text: "Partial response" });
      expect(parts[1]).toMatchObject({ type: "tool-call", toolName: "read", toolCallId: "tc-1" });
      expect(parts[2]).toMatchObject({ type: "text", text: " continued" });
      expect(content.text).toBe("Partial response continued");
      const stats = content.stats as Record<string, number>;
      expect(stats.tokens).toBe(375);
      expect(stats.toolUses).toBe(1);
    });

    it("excludes askUserQuestion tool calls from aborted parts", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const streamArgs = mockStreamText.mock.calls[0][0];
      await streamArgs.onAbort({
        steps: [
          {
            text: "Pick a color",
            toolCalls: [
              { toolName: "askUserQuestion", toolCallId: "tc-ask", args: {} },
              { toolName: "read", toolCallId: "tc-read", args: { path: "/f" } },
            ],
            toolResults: [],
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        ],
      });

      const setCalls = mockDb._updateSet.mock.calls;
      const abortUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).status === "aborted");
      const content = (abortUpdate![0] as Record<string, unknown>).content as Record<string, unknown>;
      const parts = content.parts as Array<Record<string, unknown>>;
      expect(parts.every((p) => p.toolName !== "askUserQuestion")).toBe(true);
      const stats = content.stats as Record<string, number>;
      expect(stats.toolUses).toBe(1);
    });

    it("updates conversation updatedAt on abort", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      mockDb._updateSet.mockClear();
      const streamArgs = mockStreamText.mock.calls[0][0];
      await streamArgs.onAbort({
        steps: [{ text: "partial", toolCalls: [], toolResults: [], usage: { inputTokens: 5, outputTokens: 5 } }],
      });

      const setCalls = mockDb._updateSet.mock.calls;
      const updatedAtUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).updatedAt !== undefined);
      expect(updatedAtUpdate).toBeDefined();
    });
  });

  describe("onError callback", () => {
    it("passes onError to streamText", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const streamArgs = mockStreamText.mock.calls[0][0];
      expect(streamArgs.onError).toBeDefined();
      expect(typeof streamArgs.onError).toBe("function");
    });

    it("updates assistant item status to error", async () => {
      mockDb._selectResults = [
        [{ id: "conv-1", title: "Existing Chat", userId: "user-1" }],
        [],
      ];
      mockDb._selectCallCount = 0;
      const request = buildRequest(validBody());
      await callAction(request);

      const streamArgs = mockStreamText.mock.calls[0][0];
      streamArgs.onError({ error: new Error("provider failure") });

      await vi.waitFor(() => {
        const setCalls = mockDb._updateSet.mock.calls;
        const errorUpdate = setCalls.find((c: unknown[]) => (c[0] as Record<string, unknown>).status === "error");
        expect(errorUpdate).toBeDefined();
      });
    });
  });
});
