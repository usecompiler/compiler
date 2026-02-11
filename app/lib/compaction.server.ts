import { generateText, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

const CONTEXT_LIMITS: Record<string, number> = {
  default: 128000,
};

const OVERFLOW_THRESHOLD = 0.85;

export function isOverflow(totalTokens: number, modelId: string): boolean {
  const limit = CONTEXT_LIMITS[modelId] || CONTEXT_LIMITS.default;
  return totalTokens > limit * OVERFLOW_THRESHOLD;
}

export async function compactMessages(
  messages: ModelMessage[],
  apiKey: string,
): Promise<ModelMessage[]> {
  if (messages.length <= 4) {
    return messages;
  }

  const messagesToSummarize = messages.slice(0, -4);
  const recentMessages = messages.slice(-4);

  const anthropic = createAnthropic({ apiKey });

  const { text } = await generateText({
    model: anthropic("claude-haiku-4-5-20251001"),
    system: "You are a conversation summarizer. Produce a concise summary that preserves key context for continuation.",
    messages: [
      ...messagesToSummarize,
      {
        role: "user",
        content: "Summarize this conversation for continuation. Include: what was discussed, what files were explored, what the user asked, and what remains to be done. Be concise but preserve all important context.",
      },
    ],
    maxOutputTokens: 2048,
  });

  return [
    { role: "user", content: `[Previous conversation summary]\n${text}` },
    { role: "assistant", content: [{ type: "text", text: "I understand. I have the context from our previous conversation. How can I continue helping you?" }] },
    ...recentMessages,
  ];
}
