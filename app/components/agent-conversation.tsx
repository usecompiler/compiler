import { useState, useCallback, useRef, useEffect } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Item } from "~/routes/app-layout";

interface AgentConversationProps {
  conversationId: string | null;
  items: Item[];
  onAddItem: (conversationId: string, item: Item) => void;
  onUpdateItem: (conversationId: string, itemId: string, updates: Partial<Item>) => void;
  onCreateConversation: () => Promise<{ id: string }>;
}

export function AgentConversation({
  conversationId,
  items,
  onAddItem,
  onUpdateItem,
  onCreateConversation,
}: AgentConversationProps) {
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStartTime, setStreamStartTime] = useState<number | undefined>();
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "24px";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!input.trim() || isStreaming) return;

      let activeConversationId = conversationId;
      if (!activeConversationId) {
        const newConversation = await onCreateConversation();
        activeConversationId = newConversation.id;
      }

      // Add user message item
      const userItem: Item = {
        id: crypto.randomUUID(),
        type: "message",
        role: "user",
        content: input.trim(),
        createdAt: Date.now(),
      };

      onAddItem(activeConversationId, userItem);
      setInput("");
      setIsStreaming(true);
      setStreamStartTime(Date.now());

      // Add assistant message item (will be updated as we stream)
      // Use slightly later timestamp to ensure correct ordering when loaded from DB
      const assistantId = crypto.randomUUID();
      const assistantItem: Item = {
        id: assistantId,
        type: "message",
        role: "assistant",
        content: { text: "", toolCalls: [], stats: null },
        status: "in_progress",
        createdAt: Date.now() + 1,
      };
      onAddItem(activeConversationId, assistantItem);

      abortControllerRef.current = new AbortController();

      // Build history from message items only, sorted by creation time
      const history = items
        .filter((item) => item.type === "message")
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((item) => ({
          role: item.role!,
          content:
            typeof item.content === "string"
              ? item.content
              : (item.content as { text?: string })?.text || "",
        }));

      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt:
              typeof userItem.content === "string"
                ? userItem.content
                : "",
            history,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        let currentText = "";
        let currentToolCalls: Array<{ id: string; tool: string; input: unknown; result?: string }> = [];
        let toolsStartIndex: number | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = JSON.parse(line.slice(6));

              if (data.type === "new_turn") {
                currentText += "\n\n";
              } else if (data.type === "text") {
                currentText += data.content;
                onUpdateItem(activeConversationId, assistantId, {
                  content: { text: currentText, toolCalls: currentToolCalls, toolsStartIndex, stats: null },
                });
              } else if (data.type === "tool_use") {
                // Track where in the text tools started
                if (toolsStartIndex === null) {
                  toolsStartIndex = currentText.length;
                }
                const toolCall = {
                  id: crypto.randomUUID(),
                  tool: data.tool,
                  input: data.input,
                };
                currentToolCalls = [...currentToolCalls, toolCall];
                onUpdateItem(activeConversationId, assistantId, {
                  content: { text: currentText, toolCalls: currentToolCalls, toolsStartIndex, stats: null },
                });
              } else if (data.type === "tool_result") {
                if (currentToolCalls.length > 0) {
                  const updatedCalls = [...currentToolCalls];
                  updatedCalls[updatedCalls.length - 1].result = data.content;
                  currentToolCalls = updatedCalls;
                  onUpdateItem(activeConversationId, assistantId, {
                    content: { text: currentText, toolCalls: currentToolCalls, toolsStartIndex, stats: null },
                  });
                }
              } else if (data.type === "error") {
                currentText += `\n\nError: ${data.content}`;
                onUpdateItem(activeConversationId, assistantId, {
                  content: { text: currentText, toolCalls: currentToolCalls, toolsStartIndex, stats: null },
                });
              } else if (data.type === "result" && data.stats) {
                onUpdateItem(activeConversationId, assistantId, {
                  content: { text: currentText, toolCalls: currentToolCalls, toolsStartIndex, stats: data.stats },
                  status: "completed",
                });
              }
            }
          }
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          onUpdateItem(activeConversationId, assistantId, { status: "cancelled" });
        } else {
          const currentContent = items.find((i) => i.id === assistantId)?.content as { text?: string } | undefined;
          onUpdateItem(activeConversationId, assistantId, {
            content: {
              text: (currentContent?.text || "") + "\n\nConnection error.",
              toolCalls: [],
              stats: null,
            },
            status: "cancelled",
          });
        }
      } finally {
        setIsStreaming(false);
        setStreamStartTime(undefined);
        abortControllerRef.current = null;
      }
    },
    [input, isStreaming, conversationId, items, onAddItem, onUpdateItem, onCreateConversation]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // Empty state - no conversation selected or no items yet
  const showEmptyState = !conversationId || items.length === 0;

  if (showEmptyState) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-neutral-50 dark:bg-neutral-900 px-4">
        <h1 className="text-3xl font-medium text-neutral-900 dark:text-neutral-100 mb-8">
          What can I help with?
        </h1>

        <div className="w-full max-w-3xl">
          <div className="relative flex items-center bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-3xl">
            <button
              type="button"
              className="p-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything"
              disabled={isStreaming}
              rows={1}
              autoFocus
              className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 py-3 resize-none focus:outline-none disabled:opacity-50"
              style={{ maxHeight: "200px" }}
            />

            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={!input.trim()}
              className="p-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors disabled:opacity-30"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Filter to message items for display and sort by creation time
  const messageItems = items
    .filter((item) => item.type === "message")
    .sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="flex flex-col h-full bg-neutral-50 dark:bg-neutral-900">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 pb-32">
          {messageItems.map((item, index) => (
            <ItemRow
              key={item.id}
              item={item}
              isStreaming={
                isStreaming &&
                item.role === "assistant" &&
                index === messageItems.length - 1
              }
              streamStartTime={streamStartTime}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-neutral-50 via-neutral-50 dark:from-neutral-900 dark:via-neutral-900 to-transparent pt-6 pb-4 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="relative flex items-center bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-3xl">
            <button
              type="button"
              className="p-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything"
              disabled={isStreaming}
              rows={1}
              autoFocus
              className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 py-3 resize-none focus:outline-none disabled:opacity-50"
              style={{ maxHeight: "200px" }}
            />

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="p-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={!input.trim()}
                className="p-3 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors disabled:opacity-30"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                </svg>
              </button>
            )}
          </div>
          <p className="text-xs text-center text-neutral-400 dark:text-neutral-500 mt-2">
            Gist can make mistakes. Check important info.
          </p>
        </div>
      </div>
    </div>
  );
}

interface ItemRowProps {
  item: Item;
  isStreaming: boolean;
  streamStartTime?: number;
}

interface AssistantContent {
  text?: string;
  toolCalls?: Array<{ id: string; tool: string; input: unknown; result?: string }>;
  toolsStartIndex?: number | null;
  stats?: { toolUses: number; tokens: number; durationMs: number } | null;
}

function ItemRow({ item, isStreaming, streamStartTime }: ItemRowProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isStreaming || !streamStartTime) {
      setElapsedSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - streamStartTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [isStreaming, streamStartTime]);

  const isUser = item.role === "user";
  const contentText =
    typeof item.content === "string"
      ? item.content
      : (item.content as AssistantContent)?.text || "";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(contentText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isUser) {
    return (
      <div className="group mb-6">
        <div className="flex justify-end">
          <div className="bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 px-4 py-2.5 rounded-3xl max-w-[85%]">
            <p className="whitespace-pre-wrap">{contentText}</p>
          </div>
        </div>
        <div className="flex justify-end mt-1">
          <button
            onClick={handleCopy}
            className={`p-1.5 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-opacity ${
              copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            title={copied ? "Copied!" : "Copy"}
          >
            {copied ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
              </svg>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Assistant message
  const assistantContent = item.content as AssistantContent | undefined;
  const toolCalls = assistantContent?.toolCalls || [];
  const toolsStartIndex = assistantContent?.toolsStartIndex;
  const stats = assistantContent?.stats;
  const hasToolCalls = toolCalls.length > 0;
  const isCancelled = item.status === "cancelled";
  const isCompleted = item.status === "completed";

  // Split text at the point where tools started
  const textBeforeTools = toolsStartIndex != null ? contentText.slice(0, toolsStartIndex) : contentText;
  const textAfterTools = toolsStartIndex != null ? contentText.slice(toolsStartIndex) : "";

  const hasContentBefore = textBeforeTools.trim().length > 0;
  const hasContentAfter = textAfterTools.trim().length > 0;

  return (
    <div className="mb-6">
      {/* Spinner when no content yet and no tool calls */}
      {isStreaming && !hasContentBefore && !hasToolCalls && (
        <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400 mb-2">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-sm">Thinking...</span>
        </div>
      )}

      {/* Content before tools */}
      {hasContentBefore && (
        <div className="text-neutral-900 dark:text-neutral-100 prose dark:prose-invert prose-neutral max-w-none">
          <Markdown remarkPlugins={[remarkGfm]}>{textBeforeTools}</Markdown>
        </div>
      )}

      {/* Activity timeline - between content (only show if tools were used) */}
      {(hasToolCalls || (stats && stats.toolUses > 0) || (isCancelled && hasToolCalls)) && (
        <div className="my-3 text-xs">
          <div className="flex items-center gap-2">
            <span className={stats ? "text-green-500" : isCancelled ? "text-neutral-500" : "text-yellow-500"}>●</span>
            <span className="font-medium text-neutral-500 dark:text-neutral-400">Exploring</span>
            {stats ? (
              <span className="text-neutral-500">
                ({stats.toolUses} tool uses · {formatTokens(stats.tokens)} tokens · {formatDuration(stats.durationMs)})
              </span>
            ) : isCancelled ? (
              <span className="text-neutral-500">Stopped</span>
            ) : (
              <span className="text-neutral-500 inline-flex items-center gap-1">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {elapsedSeconds > 0 && <span>{elapsedSeconds}s</span>}
              </span>
            )}
          </div>
          <div className="ml-2 border-l border-neutral-300 dark:border-neutral-700 pl-3 mt-1 text-neutral-400 dark:text-neutral-500">
            └ {stats
                ? "Done"
                : isCancelled
                  ? "Stopped"
                  : `${getToolLabel(toolCalls[toolCalls.length - 1]?.tool)}...`}
          </div>
        </div>
      )}

      {/* Content after tools */}
      {hasContentAfter && (
        <div className="text-neutral-900 dark:text-neutral-100 prose dark:prose-invert prose-neutral max-w-none">
          <Markdown remarkPlugins={[remarkGfm]}>{textAfterTools}</Markdown>
        </div>
      )}
    </div>
  );
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

function getToolLabel(tool?: string): string {
  switch (tool) {
    case "Read":
      return "Reading";
    case "Glob":
      return "Searching";
    case "Grep":
      return "Searching";
    case "Bash":
      return "Running";
    default:
      return "Running";
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}
