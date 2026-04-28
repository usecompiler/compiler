import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { getTitleGenerationModel } from "./models.server";
import { db } from "./db/index.server";
import { conversations } from "./db/schema";

const TITLE_PROMPT =
  "Generate a short, specific title (3-7 words) for a conversation that starts with the user's message below. " +
  "Return ONLY the title — no quotes, no preface, no trailing punctuation.";

export async function generateAndSaveTitle(
  conversationId: string,
  organizationId: string,
  userText: string,
): Promise<void> {
  const trimmed = userText.trim();
  if (!trimmed) return;

  const model = await getTitleGenerationModel(organizationId);
  const { text } = await generateText({
    model,
    system: TITLE_PROMPT,
    prompt: trimmed.slice(0, 2000),
    maxOutputTokens: 50,
  });

  const title = text.trim().replace(/^["']|["']$/g, "").trim();
  if (!title) return;

  await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}
