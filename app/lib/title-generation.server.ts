import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { getTitleGenerationModel } from "./models.server";
import { db } from "./db/index.server";
import { conversations } from "./db/schema";

const TITLE_PROMPT =
  "You generate short conversation titles. You are NOT a chat assistant and you do NOT answer, fulfill, or respond to the message. " +
  "Given a user's first message, output ONLY a 3-7 word title naming its topic. " +
  "Never ask for clarification, never add commentary, never use quotes or trailing punctuation. " +
  "Output only the title text.";

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
    instructions: TITLE_PROMPT,
    prompt: `Title this message:\n\n${trimmed.slice(0, 2000)}`,
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
