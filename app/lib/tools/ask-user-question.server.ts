import { z } from "zod";

export interface PendingQuestionData {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

export const askUserQuestionDescription = "Ask the user a clarifying question with predefined options. Use when you need the user to choose between alternatives or clarify their intent. Provide clear, concise options.";

export type AskUserQuestionOutput = Record<string, string>;

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
