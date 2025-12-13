import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Item types: 'message' | 'tool_call' | 'tool_output'
export const items = pgTable("items", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .references(() => conversations.id, { onDelete: "cascade" })
    .notNull(),
  type: text("type").notNull(), // 'message' | 'tool_call' | 'tool_output'
  role: text("role"), // 'user' | 'assistant' (for messages only)
  content: jsonb("content"), // flexible based on type
  toolCallId: text("tool_call_id"), // for tool_output, references a tool_call item
  status: text("status"), // 'in_progress' | 'completed' | 'cancelled'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
