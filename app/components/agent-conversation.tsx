import { useState, useCallback, useRef, useEffect } from "react";
import { useRevalidator, useBlocker, useSearchParams, useFetcher } from "react-router";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Item } from "~/lib/types";
import type { Member } from "~/lib/invitations.server";
import { PromptInput } from "./prompt-input";
import { NavigationBlocker } from "./navigation-blocker";

interface ShareLink {
  token: string;
  createdAt: string;
}

interface AgentConversationProps {
  conversationId: string;
  initialItems: Item[];
  initialPrompt?: string | null;
  onInitialPromptProcessed?: () => void;
  readOnly?: boolean;
  isSharedView?: boolean;
  isReviewRequest?: boolean;
  ownsConversation?: boolean;
  reviewers?: Member[];
  shareLink?: ShareLink | null;
  userName?: string;
  isOwner?: boolean;
}

export function AgentConversation({
  conversationId,
  initialItems,
  initialPrompt,
  onInitialPromptProcessed,
  readOnly = false,
  isSharedView = false,
  isReviewRequest = false,
  ownsConversation = false,
  reviewers = [],
  shareLink,
  userName,
  isOwner = false,
}: AgentConversationProps) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStartTime, setStreamStartTime] = useState<number | undefined>();
  const [reviewerDropdownOpen, setReviewerDropdownOpen] = useState(false);
  const [copiedReviewer, setCopiedReviewer] = useState<string | null>(null);
  const [reviewInput, setReviewInput] = useState("");
  const [pendingReviewer, setPendingReviewer] = useState<Member | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const reviewerDropdownRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isAtBottomRef = useRef(true);
  const hasProcessedInitialPrompt = useRef(false);
  const revalidator = useRevalidator();
  const [searchParams] = useSearchParams();
  const shareToken = searchParams.get("share");
  const shareFetcher = useFetcher();
  const reviewFetcher = useFetcher();

  const blocker = useBlocker(isStreaming);

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
    const container = scrollContainerRef.current;
    if (!container) return;

    const checkScrollPosition = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isAtBottom);
      isAtBottomRef.current = isAtBottom;
    };

    container.addEventListener("scroll", checkScrollPosition);
    checkScrollPosition();

    return () => container.removeEventListener("scroll", checkScrollPosition);
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [items]);

  useEffect(() => {
    if (initialItems.length > 0) {
      messagesEndRef.current?.scrollIntoView();
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

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

  useEffect(() => {
    if (!reviewerDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (reviewerDropdownRef.current && !reviewerDropdownRef.current.contains(e.target as Node)) {
        setReviewerDropdownOpen(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [reviewerDropdownOpen]);

  const addItem = useCallback(async (item: Item, token?: string | null) => {
    setItems(prev => [...prev, item]);
    await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, item, shareToken: token }),
    });
  }, [conversationId]);

  const updateItem = useCallback((itemId: string, updates: Partial<Item>) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updates } : i));
    fetch(`/api/items?id=${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  }, []);

  useEffect(() => {
    if (!pendingReviewer || shareFetcher.state !== "idle" || !shareFetcher.data) return;

    const token = (shareFetcher.data as { shareToken?: string }).shareToken;
    if (!token) {
      setPendingReviewer(null);
      return;
    }

    const reviewer = pendingReviewer;
    setPendingReviewer(null);

    const completeReviewRequest = async () => {
      const url = `${window.location.origin}/c/${conversationId}?share=${token}`;
      await navigator.clipboard.writeText(url);
      setCopiedReviewer(reviewer.userId);
      setTimeout(() => setCopiedReviewer(null), 2000);

      const reviewFormData = new FormData();
      reviewFormData.append("intent", "request-review");
      reviewFormData.append("reviewerUserId", reviewer.userId);
      reviewFormData.append("shareToken", token);
      reviewFetcher.submit(reviewFormData, {
        method: "post",
        action: `/c/${conversationId}`,
      });

      const requesterName = userName || "Someone";
      const systemItem: Item = {
        id: crypto.randomUUID(),
        type: "system",
        content: {
          text: `${requesterName} requested a review from ${reviewer.user.name}`,
          shareUrl: url,
        },
        createdAt: Date.now(),
      };
      await addItem(systemItem);
    };

    completeReviewRequest();
  }, [shareFetcher.state, shareFetcher.data, pendingReviewer, conversationId, userName, addItem, reviewFetcher]);

  const handleReviewerClick = async (reviewer: Member) => {
    setReviewerDropdownOpen(false);

    let token = shareLink?.token;

    if (token) {
      const url = `${window.location.origin}/c/${conversationId}?share=${token}`;
      await navigator.clipboard.writeText(url);
      setCopiedReviewer(reviewer.userId);
      setTimeout(() => setCopiedReviewer(null), 2000);

      const reviewFormData = new FormData();
      reviewFormData.append("intent", "request-review");
      reviewFormData.append("reviewerUserId", reviewer.userId);
      reviewFormData.append("shareToken", token);
      reviewFetcher.submit(reviewFormData, {
        method: "post",
        action: `/c/${conversationId}`,
      });

      const requesterName = userName || "Someone";
      const systemItem: Item = {
        id: crypto.randomUUID(),
        type: "system",
        content: {
          text: `${requesterName} requested a review from ${reviewer.user.name}`,
          shareUrl: url,
        },
        createdAt: Date.now(),
      };
      await addItem(systemItem);
    } else {
      setPendingReviewer(reviewer);
      const formData = new FormData();
      formData.append("intent", "create-share");
      shareFetcher.submit(formData, {
        method: "post",
        action: `/c/${conversationId}`,
      });
    }
  };

  const handleReviewSubmit = useCallback(async (approved: boolean) => {
    const reviewItem: Item = {
      id: crypto.randomUUID(),
      type: "review",
      content: {
        text: reviewInput.trim(),
        approved,
        reviewerName: userName || "Anonymous",
      },
      createdAt: Date.now(),
    };
    await addItem(reviewItem, shareToken);
    setReviewInput("");
  }, [reviewInput, userName, addItem, shareToken]);

  const handleSubmitWithPrompt = useCallback(
    async (promptText: string) => {
      if (!promptText.trim() || isStreaming || !conversationId) {
        return;
      }

      setInput("");
      setIsStreaming(true);
      setStreamStartTime(Date.now());

      const userItem: Item = {
        id: crypto.randomUUID(),
        type: "message",
        role: "user",
        content: promptText.trim(),
        createdAt: Date.now(),
      };

      if (items.length === 0) {
        const title = promptText.trim().slice(0, 50) + (promptText.length > 50 ? "..." : "");
        fetch(`/api/conversations?id=${conversationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
      }

      addItem(userItem);
      isAtBottomRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

      revalidator.revalidate();

      const assistantId = crypto.randomUUID();
      const assistantItem: Item = {
        id: assistantId,
        type: "message",
        role: "assistant",
        content: { text: "", toolCalls: [], stats: null },
        status: "in_progress",
        createdAt: Date.now() + 1,
      };
      addItem(assistantItem);

      abortControllerRef.current = new AbortController();

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

  const messageItems = items
    .filter((item) => item.type === "message" || item.type === "system" || item.type === "review")
    .sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="flex flex-col h-full bg-neutral-50 dark:bg-neutral-900">
      <NavigationBlocker blocker={blocker} />
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
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
              ownsConversation={ownsConversation}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute left-1/2 -translate-x-1/2 bottom-32 z-10 w-8 h-8 rounded-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 flex items-center justify-center text-neutral-500 dark:text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors cursor-pointer"
          aria-label="Scroll to bottom"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-neutral-50 via-neutral-50 dark:from-neutral-900 dark:via-neutral-900 to-transparent pt-6 pb-4 px-4">
        <div className="max-w-3xl mx-auto">
          {readOnly ? (
            isReviewRequest ? (
              (() => {
                let lastApprovalIndex = -1;
                for (let i = items.length - 1; i >= 0; i--) {
                  const item = items[i];
                  if (
                    item.type === "review" &&
                    (item.content as { approved?: boolean; reviewerName?: string })?.approved === true &&
                    (item.content as { reviewerName?: string })?.reviewerName === userName
                  ) {
                    lastApprovalIndex = i;
                    break;
                  }
                }
                const hasNewActivitySinceApproval = lastApprovalIndex === -1 ||
                  items.slice(lastApprovalIndex + 1).some(
                    (item) =>
                      (item.type === "message" && item.role === "user") ||
                      (item.type === "system" && typeof item.content === "object" && "shareUrl" in (item.content as object))
                  );
                const hasAlreadyApproved = !hasNewActivitySinceApproval;
                return (
                  <>
                    <div className="relative flex items-center bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-3xl">
                      <textarea
                        value={reviewInput}
                        onChange={(e) => setReviewInput(e.target.value)}
                        placeholder="Leave a comment..."
                        rows={1}
                        className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 py-3 pl-4 resize-none focus:outline-none"
                        style={{ maxHeight: "200px" }}
                        onInput={(e) => {
                          const target = e.target as HTMLTextAreaElement;
                          target.style.height = "24px";
                          target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                        }}
                      />
                      <div className="flex items-center gap-1 pr-2">
                        <button
                          type="button"
                          onClick={() => handleReviewSubmit(false)}
                          disabled={!reviewInput.trim()}
                          className="px-3 py-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          Comment
                        </button>
                        {!hasAlreadyApproved && (
                          <button
                            type="button"
                            onClick={() => handleReviewSubmit(true)}
                            className="px-3 py-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
                          >
                            Approve
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="text-xs mt-2">&nbsp;</div>
                  </>
                );
              })()
            ) : (
              <div className="text-center py-3">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Read-only mode
                </p>
              </div>
            )
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
              <div className="text-xs text-center text-neutral-400 dark:text-neutral-500 mt-2">
                Compiler can make mistakes.{" "}
                <div className="relative inline-block" ref={reviewerDropdownRef}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setReviewerDropdownOpen(!reviewerDropdownOpen);
                    }}
                    className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 underline underline-offset-2"
                  >
                    {copiedReviewer ? "Link copied!" : "Request a review"}
                  </button>
                  {reviewerDropdownOpen && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-56 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl z-50 overflow-hidden">
                      <div className="py-2 max-h-64 overflow-y-auto">
                        {reviewers.length > 0 ? (
                          reviewers.map((reviewer) => (
                            <button
                              key={reviewer.userId}
                              type="button"
                              onClick={() => handleReviewerClick(reviewer)}
                              className="w-full px-4 py-2.5 text-left text-sm text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors"
                            >
                              {reviewer.user.name}
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">
                            No team members available.
                            {isOwner && (
                              <a
                                href="/settings/organization"
                                className="block mt-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                              >
                                Invite a team member →
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
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
  ownsConversation?: boolean;
}

interface AssistantContent {
  text?: string;
  toolCalls?: Array<{ id: string; tool: string; input: unknown; result?: string }>;
  toolsStartIndex?: number | null;
  stats?: { toolUses: number; tokens: number; durationMs: number } | null;
}

function ItemRow({ item, isStreaming, streamStartTime, ownsConversation }: ItemRowProps) {
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

  if (item.type === "system") {
    const systemContent = item.content as { text?: string; shareUrl?: string } | string;
    const text = typeof systemContent === "string" ? systemContent : systemContent?.text || "";
    const shareUrl = typeof systemContent === "object" ? systemContent?.shareUrl : undefined;

    const handleCopyLink = async () => {
      if (shareUrl) {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    };

    return (
      <div className="flex flex-col items-center my-4 gap-1">
        <span className="text-sm text-neutral-500 dark:text-neutral-400">
          {text}
        </span>
        {shareUrl && ownsConversation && (
          <button
            onClick={handleCopyLink}
            className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 flex items-center gap-1"
          >
            {copied ? (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                </svg>
                Copy link
              </>
            )}
          </button>
        )}
      </div>
    );
  }

  if (item.type === "review") {
    const reviewContent = item.content as { text?: string; approved?: boolean; reviewerName?: string };
    const reviewText = reviewContent?.text || "";
    const approved = reviewContent?.approved || false;
    const reviewerName = reviewContent?.reviewerName || "Anonymous";

    if (approved) {
      return (
        <div className="flex flex-col items-center my-4 gap-1">
          <span className="text-sm text-green-600/70 dark:text-green-500/70">
            {reviewerName} approved
          </span>
          {reviewText && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center">
              {reviewText}
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="flex justify-center my-4">
        <span className="text-sm text-neutral-500 dark:text-neutral-400">
          {reviewText} – {reviewerName}
        </span>
      </div>
    );
  }

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

  const handleCopyAnswer = async () => {
    const textToCopy = hasContentAfter ? textAfterTools.trim() : contentText.trim();
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group mb-6">
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

      {(hasContentBefore || hasContentAfter) && (
        <div className="flex mt-1">
          <button
            onClick={handleCopyAnswer}
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
  if (seconds < 60) {
    return `${seconds} seconds`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
}
