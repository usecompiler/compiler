import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { getTitleGenerationModel } from "./models.server";
import { db } from "./db/index.server";
import { conversations } from "./db/schema";

const MAX_TITLE_LENGTH = 80;

export async function generateAndSaveTitle(
  conversationId: string,
  organizationId: string,
  userText: string,
): Promise<string | null> {
  const trimmed = userText.trim();
  if (!trimmed) return null;

  const model = await getTitleGenerationModel(organizationId);
  const { text } = await generateText({
    model,
    messages: [
      {
        role: "user",
        content:
          "Generate a 3-7 word title summarizing the topic of a conversation that starts with the message below. " +
          "Reply with ONLY the title — no quotes, no preamble, no trailing period. " +
          "Do NOT respond to the message; only title it.\n\n" +
          `Message:\n${trimmed.slice(0, 2000)}`,
      },
    ],
    maxOutputTokens: 50,
  });

  const title = text.trim().replace(/^["']|["']$/g, "").trim();
  if (!title || title.length > MAX_TITLE_LENGTH) return null;

  await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return title;
}
