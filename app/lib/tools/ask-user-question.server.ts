import { z } from "zod";

export interface PendingQuestionData {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

interface PendingAnswer {
  resolver: (answers: Record<string, string>) => void;
  questions: PendingQuestionData[];
}

const pendingAnswers = new Map<string, PendingAnswer>();

export const askUserQuestionDescription = "Ask the user a clarifying question with predefined options. Use when you need the user to choose between alternatives or clarify their intent. Provide clear, concise options.";

export const askUserQuestionParameters = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      header: z.string().optional(),
      options: z.array(
        z.object({
          label: z.string(),
          description: z.string().optional(),
        }),
      ),
      multiSelect: z.boolean().optional(),
    }),
  ),
});

export async function executeAskUserQuestion(
  args: z.infer<typeof askUserQuestionParameters>,
  options: { conversationId: string },
): Promise<string> {
  const answers = await new Promise<Record<string, string>>((resolve) => {
    pendingAnswers.set(options.conversationId, {
      resolver: resolve,
      questions: args.questions,
    });
  });

  pendingAnswers.delete(options.conversationId);

  return JSON.stringify(answers);
}

export function submitAnswer(conversationId: string, answers: Record<string, string>): boolean {
  const pending = pendingAnswers.get(conversationId);
  if (!pending) return false;
  pending.resolver(answers);
  return true;
}

export function getPendingQuestion(conversationId: string): PendingQuestionData[] | null {
  const pending = pendingAnswers.get(conversationId);
  return pending ? pending.questions : null;
}

export function cleanupPendingAnswers(conversationId: string): void {
  pendingAnswers.delete(conversationId);
}
