import { describe, it, expect } from "vitest";
import { itemsToUIMessages, buildDisplayItems, buildSegments } from "./conversation-helpers";
import type { Item } from "~/lib/types";
import type { UIMessage } from "@ai-sdk/react";

function userItem(id: string, content: string | object): Item {
  return { id, type: "message", role: "user", content, createdAt: Date.now() };
}

function assistantItem(id: string, content: object | null): Item {
  return { id, type: "message", role: "assistant", content, createdAt: Date.now() };
}

function textPart(text: string) {
  return { type: "text" as const, text };
}

function toolPart(toolName: string, state: string, output?: string, input?: unknown) {
  return {
    type: "dynamic-tool",
    toolName,
    toolCallId: `tc-${toolName}-${Math.random().toString(36).slice(2, 6)}`,
    state,
    input: input ?? {},
    output: output ?? "",
  } as UIMessage["parts"][number];
}

describe("itemsToUIMessages", () => {
  it("converts user items with string content", () => {
    const items = [userItem("u1", "Hello")];
    const msgs = itemsToUIMessages(items);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    });
  });

  it("converts user items with object content", () => {
    const items = [userItem("u1", { text: "World" })];
    const msgs = itemsToUIMessages(items);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].parts[0]).toMatchObject({ type: "text", text: "World" });
  });

  it("skips user items with empty text", () => {
    const items = [userItem("u1", "")];
    expect(itemsToUIMessages(items)).toHaveLength(0);
  });

  it("restores assistant parts directly from stored parts array", () => {
    const items = [
      assistantItem("a1", {
        parts: [
          { type: "text", text: "Let me look." },
          { type: "tool-call", toolName: "read", toolCallId: "tc1", input: { path: "/file" }, output: "content" },
          { type: "text", text: "Here's what I found." },
        ],
        text: "Let me look.Here's what I found.",
      }),
    ];
    const msgs = itemsToUIMessages(items);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].parts).toHaveLength(3);
    expect(msgs[0].parts[0]).toMatchObject({ type: "text", text: "Let me look." });
    expect(msgs[0].parts[1]).toMatchObject({
      type: "dynamic-tool",
      toolName: "read",
      state: "output-available",
      output: "content",
    });
    expect(msgs[0].parts[2]).toMatchObject({ type: "text", text: "Here's what I found." });
  });

  it("restores multiple tool groups interleaved with text", () => {
    const items = [
      assistantItem("a1", {
        parts: [
          { type: "text", text: "First." },
          { type: "tool-call", toolName: "read", toolCallId: "tc1", input: {}, output: "r1" },
          { type: "tool-call", toolName: "glob", toolCallId: "tc2", input: {}, output: "r2" },
          { type: "text", text: "Second." },
          { type: "tool-call", toolName: "bash", toolCallId: "tc3", input: {}, output: "r3" },
          { type: "text", text: "Third." },
        ],
        text: "First.Second.Third.",
      }),
    ];
    const msgs = itemsToUIMessages(items);
    const kinds = msgs[0].parts.map((p) => {
      if (p.type === "text") return `text:${(p as { text: string }).text}`;
      const tp = p as { toolName?: string };
      return `tool:${tp.toolName}`;
    });
    expect(kinds).toEqual([
      "text:First.",
      "tool:read",
      "tool:glob",
      "text:Second.",
      "tool:bash",
      "text:Third.",
    ]);
  });

  it("falls back to legacy toolCalls format when parts not present", () => {
    const items = [
      assistantItem("a1", {
        text: "Here is the answer.",
        toolCalls: [
          { id: "tc1", tool: "read", input: { path: "/file" }, result: "content" },
        ],
      }),
    ];
    const msgs = itemsToUIMessages(items);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].parts).toHaveLength(2);
    expect(msgs[0].parts[0]).toMatchObject({ type: "text", text: "Here is the answer." });
    expect(msgs[0].parts[1]).toMatchObject({
      type: "dynamic-tool",
      toolName: "read",
      state: "output-available",
      output: "content",
    });
  });

  it("skips empty assistant items with null content", () => {
    const items = [assistantItem("a1", null)];
    const msgs = itemsToUIMessages(items);
    expect(msgs).toHaveLength(0);
  });

  it("skips non-message items", () => {
    const items: Item[] = [
      { id: "s1", type: "system", content: { text: "system event" }, createdAt: Date.now() },
    ];
    expect(itemsToUIMessages(items)).toHaveLength(0);
  });

  it("skips assistant messages with empty parts array", () => {
    const items = [
      userItem("u1", "Hello"),
      assistantItem("a1", { text: "Hi!" }),
      userItem("u2", "Question"),
      assistantItem("a2", { parts: [], text: "" }),
      userItem("u3", "Follow up"),
    ];
    const msgs = itemsToUIMessages(items);
    const roles = msgs.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "user"]);
  });

  it("restores step-start parts from stored data", () => {
    const items = [
      assistantItem("a1", {
        parts: [
          { type: "text", text: "Let me check." },
          { type: "tool-call", toolName: "read", toolCallId: "tc1", input: {}, output: "data" },
          { type: "step-start" },
          { type: "text", text: "Here is the result." },
        ],
        text: "Let me check.Here is the result.",
      }),
    ];
    const msgs = itemsToUIMessages(items);
    expect(msgs[0].parts).toHaveLength(4);
    expect(msgs[0].parts[0]).toMatchObject({ type: "text", text: "Let me check." });
    expect(msgs[0].parts[1]).toMatchObject({ type: "dynamic-tool", toolName: "read" });
    expect(msgs[0].parts[2]).toMatchObject({ type: "step-start" });
    expect(msgs[0].parts[3]).toMatchObject({ type: "text", text: "Here is the result." });
  });

  it("preserves order across multiple items", () => {
    const items = [
      userItem("u1", "First"),
      assistantItem("a1", { text: "Response" }),
      userItem("u2", "Second"),
    ];
    const msgs = itemsToUIMessages(items);
    expect(msgs.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });
});

describe("buildDisplayItems", () => {
  it("maps user and assistant messages", () => {
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [textPart("Hi")] },
      { id: "a1", role: "assistant", parts: [textPart("Hello")] },
    ];
    const result = buildDisplayItems(messages, []);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: "user" });
    expect(result[1]).toMatchObject({ kind: "assistant" });
  });

  it("appends system items", () => {
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [textPart("Hi")] },
    ];
    const systemItems: Item[] = [
      { id: "s1", type: "system", content: { text: "event" }, createdAt: 100 },
    ];
    const result = buildDisplayItems(messages, systemItems);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ kind: "system", createdAt: 100 });
  });

  it("returns empty array for no inputs", () => {
    expect(buildDisplayItems([], [])).toEqual([]);
  });
});

describe("buildSegments", () => {
  it("groups consecutive text parts", () => {
    const parts = [textPart("First"), textPart("Second")];
    const segments = buildSegments(parts as UIMessage["parts"]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ kind: "text", text: "First\n\nSecond" });
  });

  it("groups consecutive tool parts", () => {
    const parts = [
      toolPart("read", "output-available", "done"),
      toolPart("glob", "output-available", "found"),
    ];
    const segments = buildSegments(parts as UIMessage["parts"]);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("tools");
    if (segments[0].kind === "tools") {
      expect(segments[0].tools).toHaveLength(2);
    }
  });

  it("separates text and tool segments", () => {
    const parts = [
      textPart("Before tools"),
      toolPart("read", "output-available"),
      textPart("After tools"),
    ];
    const segments = buildSegments(parts as UIMessage["parts"]);
    expect(segments.map((s) => s.kind)).toEqual(["text", "tools", "text"]);
  });

  describe("askUserQuestion handling", () => {
    it("produces qa segment when output-available with valid JSON", () => {
      const parts = [
        textPart("Pick a color"),
        toolPart(
          "askUserQuestion",
          "output-available",
          JSON.stringify({ "Favorite color": "Blue" })
        ),
        textPart("Great choice!"),
      ];
      const segments = buildSegments(parts as UIMessage["parts"]);
      expect(segments.map((s) => s.kind)).toEqual(["text", "qa", "text"]);
      expect(segments[1]).toMatchObject({
        kind: "qa",
        text: "Q: Favorite color\nA: Blue",
      });
    });

    it("formats multiple Q&A pairs", () => {
      const parts = [
        toolPart(
          "askUserQuestion",
          "output-available",
          JSON.stringify({ Color: "Red", Size: "Large" })
        ),
      ];
      const segments = buildSegments(parts as UIMessage["parts"]);
      expect(segments).toHaveLength(1);
      expect(segments[0]).toMatchObject({
        kind: "qa",
        text: "Q: Color\nA: Red\n\nQ: Size\nA: Large",
      });
    });

    it("skips askUserQuestion with input-available state", () => {
      const parts = [
        textPart("Before"),
        toolPart("askUserQuestion", "input-available"),
        textPart("After"),
      ];
      const segments = buildSegments(parts as UIMessage["parts"]);
      expect(segments).toHaveLength(1);
      expect(segments[0]).toMatchObject({ kind: "text", text: "Before\n\nAfter" });
    });

    it("skips askUserQuestion with input-streaming state", () => {
      const parts = [
        toolPart("askUserQuestion", "input-streaming"),
      ];
      const segments = buildSegments(parts as UIMessage["parts"]);
      expect(segments).toHaveLength(0);
    });

    it("skips askUserQuestion with output-available but empty output", () => {
      const parts = [
        toolPart("askUserQuestion", "output-available", ""),
      ];
      const segments = buildSegments(parts as UIMessage["parts"]);
      expect(segments).toHaveLength(0);
    });

    it("skips askUserQuestion with malformed JSON output", () => {
      const parts = [
        toolPart("askUserQuestion", "output-available", "not-json"),
      ];
      const segments = buildSegments(parts as UIMessage["parts"]);
      expect(segments).toHaveLength(0);
    });

    it("filters out empty-value answers from qa segment", () => {
      const parts = [
        toolPart(
          "askUserQuestion",
          "output-available",
          JSON.stringify({ Color: "Red", Skipped: "" })
        ),
      ];
      const segments = buildSegments(parts as UIMessage["parts"]);
      expect(segments).toHaveLength(1);
      expect(segments[0]).toMatchObject({
        kind: "qa",
        text: "Q: Color\nA: Red",
      });
    });

    it("produces no qa segment when all answers are empty", () => {
      const parts = [
        toolPart(
          "askUserQuestion",
          "output-available",
          JSON.stringify({ A: "", B: "" })
        ),
      ];
      const segments = buildSegments(parts as UIMessage["parts"]);
      expect(segments).toHaveLength(0);
    });

    it("does not group askUserQuestion into tool segments", () => {
      const parts = [
        toolPart("read", "output-available", "content"),
        toolPart("askUserQuestion", "output-available", JSON.stringify({ Q: "A" })),
        toolPart("glob", "output-available", "files"),
      ];
      const segments = buildSegments(parts as UIMessage["parts"]);
      expect(segments.map((s) => s.kind)).toEqual(["tools", "qa", "tools"]);
    });

    it("positions qa between pre-question text and continuation", () => {
      const parts = [
        textPart("Let me ask you something."),
        toolPart("read", "output-available", "file data"),
        toolPart(
          "askUserQuestion",
          "output-available",
          JSON.stringify({ Approach: "Option A" })
        ),
        textPart("Thanks, continuing with Option A."),
        toolPart("bash", "output-available", "ok"),
      ];
      const segments = buildSegments(parts as UIMessage["parts"]);
      expect(segments.map((s) => s.kind)).toEqual(["text", "tools", "qa", "text", "tools"]);
      expect(segments[2]).toMatchObject({
        kind: "qa",
        text: "Q: Approach\nA: Option A",
      });
    });
  });
});
