export type ItemType = "message" | "tool_call" | "tool_output" | "system" | "review";

export interface Item {
  id: string;
  type: ItemType;
  role?: "user" | "assistant";
  content?: unknown;
  toolCallId?: string;
  status?: "in_progress" | "completed" | "cancelled";
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  items: Item[];
  createdAt: number;
  updatedAt: number;
}
