import { useState, useCallback, useRef, useEffect } from "react";
import { useRevalidator, useBlocker } from "react-router";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Item } from "~/lib/types";
import { PromptInput } from "./prompt-input";
import { NavigationBlocker } from "./navigation-blocker";

interface AgentConversationProps {
  conversationId: string;
  initialItems: Item[];
  initialPrompt?: string | null;
  onInitialPromptProcessed?: () => void;
  readOnly?: boolean;
}

export function AgentConversation({
  conversationId,
  initialItems,
  initialPrompt,
  onInitialPromptProcessed,
  readOnly = false,
}: AgentConversationProps) {
  // Local state for items - starts with loader data
  const [items, setItems] = useState<Item[]>(initialItems);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStartTime, setStreamStartTime] = useState<number | undefined>();
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasProcessedInitialPrompt = useRef(false);
  const revalidator = useRevalidator();

  // Block navigation when streaming
  const blocker = useBlocker(isStreaming);

  // Warn on browser close/refresh when streaming
  useEffect(() => {
    if (!isStreaming) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isStreaming]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  // Handle initial prompt from URL (auto-submit on first load)
  useEffect(() => {
    const hasExistingMessages = items.length > 0;

    if (
      initialPrompt &&
      conversationId &&
      !hasProcessedInitialPrompt.current &&
      !hasExistingMessages &&
      !isStreaming
    ) {
      hasProcessedInitialPrompt.current = true;
      handleSubmitWithPrompt(initialPrompt);
      onInitialPromptProcessed?.();
    }
  }, [initialPrompt, conversationId, items.length, isStreaming]);

  const addItem = useCallback(async (item: Item) => {
    setItems(prev => [...prev, item]);
    // Persist to DB
    await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, item }),
    });
  }, [conversationId]);

  const updateItem = useCallback((itemId: string, updates: Partial<Item>) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updates } : i));
    // Persist to DB (fire and forget)
    fetch(`/api/items?id=${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  }, []);

  const handleSubmitWithPrompt = useCallback(
    async (promptText: string) => {
      if (!promptText.trim() || isStreaming || !conversationId) {
        return;
      }

      // Add user message item
      const userItem: Item = {
        id: crypto.randomUUID(),
        type: "message",
        role: "user",
        content: promptText.trim(),
        createdAt: Date.now(),
      };

      // Update title if this is the first message
      if (items.length === 0) {
        const title = promptText.trim().slice(0, 50) + (promptText.length > 50 ? "..." : "");
        fetch(`/api/conversations?id=${conversationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
      }

      await addItem(userItem);
      setInput("");
      setIsStreaming(true);
      setStreamStartTime(Date.now());

      // Revalidate to update sidebar order (conversation moves to top)
      revalidator.revalidate();

      // Add assistant message item (will be updated as we stream)
      const assistantId = crypto.randomUUID();
      const assistantItem: Item = {
        id: assistantId,
        type: "message",
        role: "assistant",
        content: { text: "", toolCalls: [], stats: null },
        status: "in_progress",
        createdAt: Date.now() + 1,
      };
      await addItem(assistantItem);

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
            prompt: promptText.trim(),
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
                updateItem(assistantId, {
                  content: { text: currentText, toolCalls: currentToolCalls, toolsStartIndex, stats: null },
                });
              } else if (data.type === "tool_use") {
                if (toolsStartIndex === null) {
                  toolsStartIndex = currentText.length;
                }
                const toolCall = {
                  id: crypto.randomUUID(),
                  tool: data.tool,
                  input: data.input,
                };
                currentToolCalls = [...currentToolCalls, toolCall];
                updateItem(assistantId, {
                  content: { text: currentText, toolCalls: currentToolCalls, toolsStartIndex, stats: null },
                });
              } else if (data.type === "tool_result") {
                if (currentToolCalls.length > 0) {
                  const updatedCalls = [...currentToolCalls];
                  updatedCalls[updatedCalls.length - 1].result = data.content;
                  currentToolCalls = updatedCalls;
                  updateItem(assistantId, {
                    content: { text: currentText, toolCalls: currentToolCalls, toolsStartIndex, stats: null },
                  });
                }
              } else if (data.type === "error") {
                currentText += `\n\nError: ${data.content}`;
                updateItem(assistantId, {
                  content: { text: currentText, toolCalls: currentToolCalls, toolsStartIndex, stats: null },
                });
              } else if (data.type === "result" && data.stats) {
                updateItem(assistantId, {
                  content: { text: currentText, toolCalls: currentToolCalls, toolsStartIndex, stats: data.stats },
                  status: "completed",
                });
              }
            }
          }
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          updateItem(assistantId, { status: "cancelled" });
        } else {
          updateItem(assistantId, {
            content: {
              text: "\n\nConnection error.",
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
    [conversationId, items, addItem, updateItem, isStreaming]
  );

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      handleSubmitWithPrompt(input);
    },
    [input, handleSubmitWithPrompt]
  );

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // Show loading state while initial prompt is being processed
  const showLoadingState = initialPrompt && !hasProcessedInitialPrompt.current && items.length === 0;

  if (showLoadingState) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-neutral-50 dark:bg-neutral-900 px-4">
        <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Starting conversation...</span>
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
      <NavigationBlocker blocker={blocker} />
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
          {readOnly ? (
            <div className="text-center py-3">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Read-only mode
              </p>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit}>
                <PromptInput
                  value={input}
                  onChange={setInput}
                  onSubmit={handleSubmit}
                  isStreaming={isStreaming}
                  onStop={handleStop}
                  autoFocus
                  autoFocusKey={conversationId}
                />
              </form>
              <p className="text-xs text-center text-neutral-400 dark:text-neutral-500 mt-2">
                Gist can make mistakes. Check important info.
              </p>
            </>
          )}
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

  const textBeforeTools = toolsStartIndex != null ? contentText.slice(0, toolsStartIndex) : contentText;
  const textAfterTools = toolsStartIndex != null ? contentText.slice(toolsStartIndex) : "";

  const hasContentBefore = textBeforeTools.trim().length > 0;
  const hasContentAfter = textAfterTools.trim().length > 0;

  return (
    <div className="mb-6">
      {isStreaming && !hasContentBefore && !hasToolCalls && (
        <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400 mb-2">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-sm">Thinking...</span>
        </div>
      )}

      {hasContentBefore && (
        <div className="text-neutral-900 dark:text-neutral-100 prose dark:prose-invert prose-neutral max-w-none">
          <Markdown remarkPlugins={[remarkGfm]}>{textBeforeTools}</Markdown>
        </div>
      )}

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
