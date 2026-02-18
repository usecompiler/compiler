import type { UIMessage } from "@ai-sdk/react";
import type { Item } from "~/lib/types";

export interface MessageItem {
  id: string;
  role?: string | null;
  content?: unknown;
}

export type DisplayItem =
  | { kind: "user"; message: UIMessage; createdAt: number }
  | { kind: "assistant"; message: UIMessage; createdAt: number }
  | { kind: "system"; item: Item; createdAt: number };

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "tools"; tools: Array<UIMessage["parts"][number]> }
  | { kind: "qa"; text: string };

export function itemsToUIMessages(dbItems: MessageItem[]): UIMessage[] {
  const messages: UIMessage[] = [];

  for (const item of dbItems) {
    if ("type" in item && (item as Item).type !== "message") continue;

    if (item.role === "user") {
      const text =
        typeof item.content === "string"
          ? item.content
          : (item.content as { text?: string })?.text || "";
      if (text) {
        messages.push({
          id: item.id,
          role: "user",
          parts: [{ type: "text", text }],
        });
      }
    } else if (item.role === "assistant") {
      const content = item.content as {
        parts?: Array<{ type: string; text?: string; toolName?: string; toolCallId?: string; input?: unknown; output?: string }>;
        text?: string;
        toolCalls?: Array<{ id: string; tool: string; input: unknown; result?: string }>;
      } | null;

      const uiParts: UIMessage["parts"] = [];

      if (content?.parts) {
        for (const p of content.parts) {
          if (p.type === "step-start") {
            uiParts.push({ type: "step-start" } as UIMessage["parts"][number]);
          } else if (p.type === "text" && p.text) {
            uiParts.push({ type: "text", text: p.text });
          } else if (p.type === "tool-call" && p.toolName && p.toolName !== "step-start") {
            uiParts.push({
              type: "dynamic-tool",
              toolName: p.toolName,
              toolCallId: p.toolCallId || crypto.randomUUID(),
              state: "output-available",
              input: p.input,
              output: p.output || "",
            } as UIMessage["parts"][number]);
          }
        }
      } else {
        if (content?.text) {
          uiParts.push({ type: "text", text: content.text });
        }
        if (content?.toolCalls) {
          for (const tc of content.toolCalls) {
            uiParts.push({
              type: "dynamic-tool",
              toolName: tc.tool,
              toolCallId: tc.id,
              state: "output-available",
              input: tc.input,
              output: tc.result || "",
            } as UIMessage["parts"][number]);
          }
        }
      }

      if (uiParts.length > 0) {
        messages.push({
          id: item.id,
          role: "assistant",
          parts: uiParts,
        });
      }
    }
  }

  return messages;
}

export function buildDisplayItems(messages: UIMessage[], systemItems: Item[]): DisplayItem[] {
  const items: DisplayItem[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      items.push({ kind: "user", message: msg, createdAt: 0 });
    } else if (msg.role === "assistant") {
      items.push({ kind: "assistant", message: msg, createdAt: 0 });
    }
  }

  for (const item of systemItems) {
    if (item.type === "system") {
      items.push({ kind: "system", item, createdAt: item.createdAt });
    }
  }

  return items;
}

export function buildSegments(parts: UIMessage["parts"]): Segment[] {
  const segments: Segment[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      const last = segments[segments.length - 1];
      if (last && last.kind === "text") {
        last.text += "\n\n" + (part as { text: string }).text;
      } else {
        segments.push({ kind: "text", text: (part as { text: string }).text });
      }
    } else if (part.type === "dynamic-tool" || (part.type as string).startsWith("tool-")) {
      const tp = part as { toolName?: string; type: string; state?: string; output?: string };
      const name = tp.toolName || tp.type.replace("tool-", "");
      if (name === "askUserQuestion") {
        if (tp.state === "output-available" && tp.output) {
          try {
            const parsed = JSON.parse(tp.output) as Record<string, string>;
            const qaLines = Object.entries(parsed)
              .filter(([, v]) => v)
              .map(([k, v]) => `Q: ${k}\nA: ${v}`);
            if (qaLines.length > 0) {
              segments.push({ kind: "qa", text: qaLines.join("\n\n") });
            }
          } catch {
            // skip malformed output
          }
        }
        continue;
      }
      const last = segments[segments.length - 1];
      if (last && last.kind === "tools") {
        last.tools.push(part);
      } else {
        segments.push({ kind: "tools", tools: [part] });
      }
    }
  }
  return segments;
}
