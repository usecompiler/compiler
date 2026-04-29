import { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import { useRevalidator, useBlocker, Link } from "react-router";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useStickToBottom } from "use-stick-to-bottom";
import { Streamdown } from "streamdown";
import type { Item } from "~/lib/types";
import type { PendingQuestionData } from "~/lib/agent.server";
import { PromptInput, type PendingFile } from "./prompt-input";
import { NavigationBlocker } from "./navigation-blocker";
import { itemsToUIMessages, buildDisplayItems, buildSegments } from "./conversation-helpers";

interface AnsweredQuestion {
  question: string;
  answer: string;
}

export interface BlobMeta {
  id: string;
  contentType: string;
  filename?: string;
}

interface AgentConversationProps {
  conversationId: string;
  initialItems: Item[];
  initialPrompt?: string | null;
  onInitialPromptProcessed?: () => void;
  readOnly?: boolean;
  isSharedView?: boolean;
  ownsConversation?: boolean;
  onFork?: () => void;
  source?: { id: string; title: string; shareToken: string | null } | null;
  initialPendingQuestion?: PendingQuestionData[] | null;
  initialBlobsByItemId?: Record<string, BlobMeta[]>;
  initialBlobIds?: string;
  hasStorageConfig?: boolean;
}

export function AgentConversation({
  conversationId,
  initialItems,
  initialPrompt,
  onInitialPromptProcessed,
  readOnly = false,
  isSharedView = false,
  ownsConversation = false,
  onFork,
  source,
  initialPendingQuestion,
  initialBlobsByItemId,
  initialBlobIds,
  hasStorageConfig = false,
}: AgentConversationProps) {
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [blobsByItemId, setBlobsByItemId] = useState<Record<string, BlobMeta[]>>(initialBlobsByItemId || {});
  const [streamStartTime, setStreamStartTime] = useState<number | undefined>();
  const [networkError, setNetworkError] = useState(false);
  const savedPromptRef = useRef("");
  const savedFilesRef = useRef<PendingFile[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<{
    questions: PendingQuestionData[];
    toolCallId: string;
  } | null>(
    initialPendingQuestion ? { questions: initialPendingQuestion, toolCallId: "" } : null
  );
  const [systemItems, setSystemItems] = useState<Item[]>(
    initialItems.filter((i) => i.type === "system")
  );

  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom();
  const hasProcessedInitialPrompt = useRef(false);
  const revalidator = useRevalidator();
  const pendingBlobIdsRef = useRef<string[]>([]);

  const initialUIMessages = useMemo(() => itemsToUIMessages(initialItems), []);

  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/agent",
    body: { conversationId },
    prepareSendMessagesRequest({ messages: msgs, body: extraBody }) {
      const lastMessage = msgs[msgs.length - 1];
      return {
        body: {
          message: lastMessage,
          conversationId,
          blobIds: pendingBlobIdsRef.current.length > 0 ? pendingBlobIdsRef.current : undefined,
          ...(extraBody || {}),
        },
      };
    },
  }), [conversationId]);

  const {
    messages,
    sendMessage,
    status,
    stop,
    addToolOutput,
    setMessages,
  } = useChat({
    id: conversationId,
    messages: initialUIMessages,
    transport,
    experimental_throttle: 50,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall({ toolCall }) {
      if (toolCall.toolName === "askUserQuestion") {
        const toolInput = toolCall.input as { questions: PendingQuestionData[] };
        setPendingQuestion({
          questions: toolInput.questions,
          toolCallId: toolCall.toolCallId,
        });
      }
    },
    onData(dataPart) {
      if (dataPart.type === "data-title") {
        revalidator.revalidate();
      }
    },
    onFinish() {
      setStreamStartTime(undefined);
      revalidator.revalidate();
    },
    onError() {
      setStreamStartTime(undefined);
      setNetworkError(true);
      setMessages((prev) => {
        let lastUserIndex = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === "user") {
            lastUserIndex = i;
            break;
          }
        }
        if (lastUserIndex === -1) return prev;
        return prev.filter((_, i) => i !== lastUserIndex);
      });
      setInput((current) => current || savedPromptRef.current);
      setPendingFiles((current) => current.length > 0 ? current : savedFilesRef.current);
    },
  });

  const isStreaming = status === "streaming" || status === "submitted";

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
    if (!networkError) return;
    const timer = setTimeout(() => setNetworkError(false), 8000);
    return () => clearTimeout(timer);
  }, [networkError]);

  const handleFilesChange = useCallback((files: File[]) => {
    const remaining = 5 - pendingFiles.length;
    const filesToAdd = files.slice(0, remaining);
    if (filesToAdd.length === 0) return;

    const newFiles: PendingFile[] = filesToAdd.map((file) => ({
      file,
      uploading: true,
      previewUrl: URL.createObjectURL(file),
    }));

    setPendingFiles((prev) => [...prev, ...newFiles]);

    filesToAdd.forEach((file) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("conversationId", conversationId);

      fetch("/api/upload", { method: "POST", body: formData })
        .then((res) => res.json())
        .then((data: { blobId?: string; error?: string }) => {
          if (data.blobId) {
            setPendingFiles((prev) =>
              prev.map((f) =>
                f.file === file ? { ...f, blobId: data.blobId, uploading: false } : f
              )
            );
          } else {
            setPendingFiles((prev) => prev.filter((f) => f.file !== file));
          }
        })
        .catch(() => {
          setPendingFiles((prev) => prev.filter((f) => f.file !== file));
        });
    });
  }, [conversationId, pendingFiles.length]);

  const handleRemoveFile = useCallback((index: number) => {
    setPendingFiles((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  useEffect(() => {
    const hasExistingMessages = messages.length > initialUIMessages.length;

    const hasInitialContent = initialPrompt || initialBlobIds;
    if (
      hasInitialContent &&
      conversationId &&
      !hasProcessedInitialPrompt.current &&
      !hasExistingMessages &&
      !isStreaming
    ) {
      hasProcessedInitialPrompt.current = true;
      handleSubmitWithPrompt(initialPrompt || "", initialBlobIds);
      onInitialPromptProcessed?.();
    }
  }, [initialPrompt, conversationId, messages.length, isStreaming]);

  const handleSubmitWithPrompt = useCallback(
    async (promptText: string, extraBlobIds?: string) => {
      const hasUploading = pendingFiles.some((f) => f.uploading);
      const hasExtraBlobIds = extraBlobIds && extraBlobIds.length > 0;
      if ((!promptText.trim() && pendingFiles.length === 0 && !hasExtraBlobIds) || isStreaming || !conversationId || hasUploading) {
        return;
      }

      const fileBlobIds = pendingFiles
        .map((f) => f.blobId)
        .filter((id): id is string => !!id);

      const extraParsed = extraBlobIds ? extraBlobIds.split(",").filter(Boolean) : [];
      const allBlobIds = [...fileBlobIds, ...extraParsed];

      const userMessageId = crypto.randomUUID();

      savedPromptRef.current = promptText.trim() || "Describe this file.";
      savedFilesRef.current = [...pendingFiles];

      setInput("");
      setPendingFiles([]);
      setStreamStartTime(Date.now());
      pendingBlobIdsRef.current = allBlobIds;

      if (allBlobIds.length > 0) {
        const localMetas = pendingFiles
          .filter((f) => f.blobId)
          .map((f) => ({
            id: f.blobId!,
            contentType: f.file.type || "application/octet-stream",
            filename: f.file.name,
          }));

        if (extraParsed.length > 0) {
          const localIds = new Set(localMetas.map((m) => m.id));
          const missingIds = extraParsed.filter((id) => !localIds.has(id));
          if (missingIds.length > 0) {
            fetch(`/api/blobs?ids=${missingIds.join(",")}`)
              .then((res) => res.json())
              .then((data: { blobs: BlobMeta[] }) => {
                setBlobsByItemId((prev) => ({
                  ...prev,
                  [userMessageId]: [...(prev[userMessageId] || []), ...data.blobs],
                }));
              })
              .catch(() => {});
          }
        }

        setBlobsByItemId((prev) => ({
          ...prev,
          [userMessageId]: localMetas,
        }));
      }

      scrollToBottom();

      revalidator.revalidate();

      await sendMessage({
        id: userMessageId,
        parts: [{ type: "text", text: promptText.trim() || "Describe this file." }],
      });

      pendingBlobIdsRef.current = [];
    },
    [conversationId, sendMessage, isStreaming, pendingFiles, revalidator]
  );

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      handleSubmitWithPrompt(input);
    },
    [input, handleSubmitWithPrompt]
  );

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  const allDisplayItems = useMemo(
    () => buildDisplayItems(messages, systemItems),
    [messages, systemItems],
  );

  const lastAssistantId = useMemo(() => {
    for (let i = allDisplayItems.length - 1; i >= 0; i--) {
      const d = allDisplayItems[i];
      if (d.kind === "assistant") return d.message.id;
    }
    return null;
  }, [allDisplayItems]);

  const showLoadingState = initialPrompt && !hasProcessedInitialPrompt.current && initialUIMessages.length === 0;

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

  return (
    <div className="flex flex-col h-full bg-neutral-50 dark:bg-neutral-900">
      <NavigationBlocker blocker={blocker} />
      {networkError && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900 shadow-lg animate-[slideIn_0.3s_ease-out]">
          <svg className="w-5 h-5 text-amber-500 dark:text-amber-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <span className="text-sm text-amber-800 dark:text-amber-200">
            We couldn't connect. Please check your network connection and try again.
          </span>
          <button
            onClick={() => setNetworkError(false)}
            className="p-1 text-amber-500 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div ref={contentRef} className="max-w-3xl mx-auto px-4 py-6 pb-32">
          {source && (
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
              <span className="text-xs text-neutral-400 dark:text-neutral-500 whitespace-nowrap">
                Forked from{" "}
                {source.shareToken ? (
                  <Link to={`/c/${source.id}?share=${source.shareToken}`} className="underline font-medium hover:text-neutral-600 dark:hover:text-neutral-300">
                    {source.title}
                  </Link>
                ) : (
                  source.title
                )}
              </span>
              <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
            </div>
          )}
          {allDisplayItems.map((displayItem) => {
            if (displayItem.kind === "system") {
              return (
                <SystemItemRow
                  key={displayItem.item.id}
                  item={displayItem.item}
                  ownsConversation={ownsConversation}
                />
              );
            }
            if (displayItem.kind === "user") {
              return (
                <UserMessageRow
                  key={displayItem.message.id}
                  message={displayItem.message}
                  itemBlobs={blobsByItemId[displayItem.message.id]}
                />
              );
            }
            if (displayItem.kind === "assistant") {
              const isLast = displayItem.message.id === lastAssistantId;
              return (
                <AssistantMessageRow
                  key={displayItem.message.id}
                  message={displayItem.message}
                  isStreaming={isStreaming && isLast}
                  streamStartTime={isLast ? streamStartTime : undefined}
                />
              );
            }
            return null;
          })}
          {(isStreaming && (allDisplayItems.length === 0 || allDisplayItems[allDisplayItems.length - 1].kind !== "assistant")) && (
            <div className="group mb-6">
              <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400 mb-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-sm">Thinking...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {!isAtBottom && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute left-1/2 -translate-x-1/2 bottom-32 z-10 w-8 h-8 rounded-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 flex items-center justify-center text-neutral-500 dark:text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors cursor-pointer"
          aria-label="Scroll to bottom"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-neutral-50 via-neutral-50 dark:from-neutral-900 dark:via-neutral-900 to-transparent pt-6 pb-safe px-4">
        <div className="max-w-3xl mx-auto">
          {readOnly ? (
            <div className="text-center py-3">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {isSharedView
                  ? <>Viewing shared conversation &mdash;{" "}
                      <button
                        onClick={onFork}
                        className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
                      >fork it</button>
                      {" "}to continue
                    </>
                  : "Read-only mode"}
              </p>
            </div>
          ) : (
            <>
              {pendingQuestion ? (
                <div className="pt-2">
                  <QuestionCard
                    pendingQuestion={pendingQuestion}
                    conversationId={conversationId}
                    onAnswered={async (answered) => {
                      const answersPayload: Record<string, string> = {};
                      pendingQuestion.questions.forEach((q) => {
                        const key = q.header || q.question;
                        const found = answered.find((a) => a.question === q.question);
                        answersPayload[key] = found?.answer || "";
                      });

                      if (answered.length > 0) {
                        const qaText = answered
                          .map((aq) => `Q: ${aq.question}\nA: ${aq.answer}`)
                          .join("\n\n");
                        const answerItem: Item = {
                          id: crypto.randomUUID(),
                          type: "message",
                          role: "user",
                          content: qaText,
                          createdAt: Date.now(),
                        };
                        await fetch("/api/items", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ conversationId, item: answerItem }),
                        });
                      }

                      const toolCallId = pendingQuestion.toolCallId;
                      setPendingQuestion(null);
                      setStreamStartTime(Date.now());

                      await addToolOutput({
                        tool: "askUserQuestion" as never,
                        toolCallId,
                        output: JSON.stringify(answersPayload) as never,
                      });
                    }}
                    onSkipped={async () => {
                      const emptyAnswers: Record<string, string> = {};
                      pendingQuestion.questions.forEach((q) => {
                        emptyAnswers[q.header || q.question] = "";
                      });

                      const toolCallId = pendingQuestion.toolCallId;
                      setPendingQuestion(null);
                      setStreamStartTime(Date.now());

                      await addToolOutput({
                        tool: "askUserQuestion" as never,
                        toolCallId,
                        output: JSON.stringify(emptyAnswers) as never,
                      });
                    }}
                  />
                  <div className="text-xs text-center text-neutral-500 dark:text-neutral-400 mt-2">
                    <span className="text-neutral-400 dark:text-neutral-500">↑↓</span> to navigate
                    <span className="mx-1.5">·</span>
                    <span className="text-neutral-400 dark:text-neutral-500">Enter</span> to select
                    <span className="mx-1.5">·</span>
                    <span className="text-neutral-400 dark:text-neutral-500">Esc</span> to skip
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit}>
                  <PromptInput
                    value={input}
                    onChange={setInput}
                    onSubmit={handleSubmit}
                    isStreaming={isStreaming}
                    onStop={handleStop}
                    autoFocus
                    autoFocusKey={conversationId}
                    files={pendingFiles}
                    onFilesChange={hasStorageConfig ? handleFilesChange : undefined}
                    onRemoveFile={hasStorageConfig ? handleRemoveFile : undefined}
                  />
                </form>
              )}
              <div className={`text-xs text-center text-neutral-400 dark:text-neutral-500 mt-2${pendingQuestion ? " hidden" : ""}`}>
                Compiler can make mistakes. Please double-check responses.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const UserMessageRow = memo(function UserMessageRow({ message, itemBlobs }: { message: UIMessage; itemBlobs?: BlobMeta[] }) {
  const [copied, setCopied] = useState(false);
  const contentText = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(contentText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fileExtension = (filename: string) => {
    const ext = filename.split(".").pop()?.toUpperCase();
    return ext || "FILE";
  };

  return (
    <div className="group mb-6">
      {itemBlobs && itemBlobs.length > 0 && (
        <div className="flex justify-end mb-2">
          <div className="flex gap-2 flex-wrap justify-end max-w-[85%]">
            {itemBlobs.map((blob) =>
              blob.contentType.startsWith("image/") ? (
                <a
                  key={blob.id}
                  href={`/api/image/${blob.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-[160px] h-[160px] rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-700"
                >
                  <img
                    src={`/api/image/${blob.id}`}
                    alt={blob.filename || "Attached image"}
                    className="w-full h-full object-cover"
                  />
                </a>
              ) : (
                <a
                  key={blob.id}
                  href={`/api/image/${blob.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col justify-between w-[160px] h-[160px] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 p-3 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                >
                  <span className="text-sm text-neutral-900 dark:text-neutral-100 break-words line-clamp-4 leading-snug">
                    {blob.filename || "file"}
                  </span>
                  <span className="inline-flex self-start px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 border border-neutral-300 dark:border-neutral-600 rounded">
                    {fileExtension(blob.filename || "file")}
                  </span>
                </a>
              )
            )}
          </div>
        </div>
      )}
      {contentText && (
        <div className="flex justify-end">
          <div className="bg-[#efefef] dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 px-4 py-2.5 rounded-3xl max-w-[85%]">
            <p className="whitespace-pre-wrap">{contentText}</p>
          </div>
        </div>
      )}
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
});

interface AssistantMessageRowProps {
  message: UIMessage;
  isStreaming: boolean;
  streamStartTime?: number;
}

const AssistantMessageRow = memo(function AssistantMessageRow({ message, isStreaming, streamStartTime }: AssistantMessageRowProps) {
  const [copied, setCopied] = useState(false);

  const segments = useMemo(() => buildSegments(message.parts), [message.parts]);

  const allText = useMemo(
    () => segments
      .filter((s): s is { kind: "text"; text: string } => s.kind === "text")
      .map((s) => s.text)
      .join("\n\n"),
    [segments],
  );
  const hasContent = allText.trim().length > 0;
  const hasAnything = segments.length > 0;

  const handleCopyAnswer = async () => {
    await navigator.clipboard.writeText(allText.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group mb-6">
      {isStreaming && !hasAnything && (
        <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400 mb-2">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-sm">Thinking...</span>
        </div>
      )}

      {segments.map((segment, i) => {
        if (segment.kind === "text" && segment.text.trim()) {
          return <Streamdown key={i}>{segment.text}</Streamdown>;
        }
        if (segment.kind === "qa") {
          return (
            <div key={i} className="my-4 flex justify-end">
              <div className="bg-[#efefef] dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 px-4 py-2.5 rounded-3xl max-w-[85%]">
                <p className="whitespace-pre-wrap">{segment.text}</p>
              </div>
            </div>
          );
        }
        if (segment.kind === "tools") {
          const isLastSegment = i === segments.length - 1;
          const toolsDone = segment.tools.every((p) => {
            const tp = p as { state?: string };
            return tp.state === "output-available" || tp.state === "output-error";
          });
          const done = !isStreaming || !isLastSegment ? toolsDone : false;
          const lastTool = segment.tools[segment.tools.length - 1] as { toolName?: string; type: string };
          const lastToolName = lastTool.toolName || lastTool.type.replace("tool-", "");

          return (
            <div key={i} className="my-3 text-xs">
              <div className="flex items-center gap-2">
                <span className={done ? "text-green-500" : "text-yellow-500"}>●</span>
                <span className="font-medium text-neutral-500 dark:text-neutral-400">Exploring</span>
                {done ? (
                  <span className="text-neutral-500">
                    ({segment.tools.length} tool use{segment.tools.length !== 1 ? "s" : ""})
                  </span>
                ) : (
                  <span className="text-neutral-500 inline-flex items-center gap-1">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {isLastSegment && isStreaming && streamStartTime !== undefined && <StreamingElapsed startTime={streamStartTime} />}
                  </span>
                )}
              </div>
              <div className="ml-2 border-l border-neutral-300 dark:border-neutral-700 pl-3 mt-1 text-neutral-400 dark:text-neutral-500">
                └ {done
                    ? "Done"
                    : `${getToolLabel(lastToolName)}...`}
              </div>
            </div>
          );
        }
        return null;
      })}

      {hasContent && (
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
});

function StreamingElapsed({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  if (elapsed === 0) return null;
  return <span>{elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}</span>;
}

const SystemItemRow = memo(function SystemItemRow({ item, ownsConversation }: { item: Item; ownsConversation?: boolean }) {
  const [copied, setCopied] = useState(false);
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
});

interface QuestionCardProps {
  pendingQuestion: { questions: PendingQuestionData[]; toolCallId: string };
  conversationId: string;
  onAnswered: (answered: AnsweredQuestion[]) => void;
  onSkipped: () => void;
}

function QuestionCard({ pendingQuestion, conversationId, onAnswered, onSkipped }: QuestionCardProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [freeText, setFreeText] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [multiSelections, setMultiSelections] = useState<Set<string>>(new Set());
  const [isFreeTextFocused, setIsFreeTextFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const freeTextRef = useRef<HTMLInputElement>(null);
  const total = pendingQuestion.questions.length;
  const question = pendingQuestion.questions[currentIndex];
  const isMulti = question.multiSelect === true;
  const optionCount = question.options.length;

  const submitAllAnswers = useCallback(async (finalAnswers: Record<number, string>) => {
    const answeredList: AnsweredQuestion[] = [];
    pendingQuestion.questions.forEach((q, i) => {
      if (finalAnswers[i]) {
        answeredList.push({ question: q.question, answer: finalAnswers[i] });
      }
    });

    onAnswered(answeredList);
  }, [pendingQuestion.questions, onAnswered]);

  const advanceOrSubmit = useCallback((updated: Record<number, string>) => {
    setSelectedOption(null);
    setHighlightedIndex(0);
    setMultiSelections(new Set());
    setFreeText("");

    if (currentIndex < total - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      submitAllAnswers(updated);
    }
  }, [currentIndex, total, submitAllAnswers]);

  const handleSelect = useCallback((optionLabel: string) => {
    if (isMulti) {
      setMultiSelections((prev) => {
        const next = new Set(prev);
        if (next.has(optionLabel)) {
          next.delete(optionLabel);
        } else {
          next.add(optionLabel);
        }
        return next;
      });
      return;
    }
    const updated = { ...answers, [currentIndex]: optionLabel };
    setAnswers(updated);
    advanceOrSubmit(updated);
  }, [isMulti, answers, currentIndex, advanceOrSubmit]);

  const handleMultiSubmit = useCallback(() => {
    const value = Array.from(multiSelections).join(", ");
    const updated = { ...answers, [currentIndex]: value };
    setAnswers(updated);
    advanceOrSubmit(updated);
  }, [multiSelections, answers, currentIndex, advanceOrSubmit]);

  const handleFreeTextSubmit = useCallback(() => {
    if (!freeText.trim()) return;
    if (isMulti) {
      setMultiSelections((prev) => {
        const next = new Set(prev);
        next.add(freeText.trim());
        return next;
      });
      setFreeText("");
      return;
    }
    const updated = { ...answers, [currentIndex]: freeText.trim() };
    setAnswers(updated);
    advanceOrSubmit(updated);
  }, [freeText, isMulti, answers, currentIndex, advanceOrSubmit]);

  const handleSkip = useCallback(() => {
    const updated = { ...answers, [currentIndex]: "" };
    setAnswers(updated);
    setFreeText("");
    setSelectedOption(null);
    setHighlightedIndex(0);
    setMultiSelections(new Set());

    if (currentIndex < total - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      submitAllAnswers(updated);
    }
  }, [answers, currentIndex, total, submitAllAnswers]);

  const handleDismiss = useCallback(async () => {
    onSkipped();
  }, [onSkipped]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.focus();
  }, [currentIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isFreeTextFocused) {
        if (e.key === "Escape") {
          e.preventDefault();
          freeTextRef.current?.blur();
          setIsFreeTextFocused(false);
          containerRef.current?.focus();
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, optionCount - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (isMulti && multiSelections.size > 0) {
          handleMultiSubmit();
        } else if (highlightedIndex < question.options.length) {
          if (isMulti) {
            handleSelect(question.options[highlightedIndex].label);
          } else {
            setSelectedOption(highlightedIndex);
            const label = question.options[highlightedIndex].label;
            setTimeout(() => handleSelect(label), 150);
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleSkip();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [highlightedIndex, optionCount, question.options, handleSelect, handleSkip, isFreeTextFocused, isMulti, multiSelections, handleMultiSubmit]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="rounded-2xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 overflow-hidden focus:outline-none"
    >
      <div className="flex items-start justify-between px-5 pt-4 pb-3">
        <p className="text-sm text-neutral-900 dark:text-neutral-100 flex-1 pr-4">
          {question.question}{isMulti ? " (Select all that apply)" : ""}
        </p>
        <div className="flex items-center gap-3 shrink-0">
          {total > 1 && (
            <span className="text-xs text-neutral-400 dark:text-neutral-500">
              {currentIndex + 1} of {total}
            </span>
          )}
          <button
            onClick={handleDismiss}
            className="p-0.5 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-3">
        {question.options.map((option, i) => {
          const isChecked = isMulti && multiSelections.has(option.label);
          return (
            <div key={i}>
              <button
                onClick={() => {
                  setHighlightedIndex(i);
                  if (isMulti) {
                    handleSelect(option.label);
                  } else {
                    setSelectedOption(i);
                    setTimeout(() => handleSelect(option.label), 150);
                  }
                }}
                onMouseEnter={() => setHighlightedIndex(i)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${
                  selectedOption === i
                    ? "bg-neutral-100 dark:bg-neutral-700"
                    : highlightedIndex === i || isChecked
                      ? "bg-neutral-50 dark:bg-neutral-700/50"
                      : ""
                }`}
              >
                <span className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium shrink-0 ${
                  selectedOption === i || highlightedIndex === i || isChecked
                    ? "bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900"
                    : "border border-neutral-300 dark:border-neutral-600 text-neutral-500 dark:text-neutral-400"
                }`}>
                  {isChecked ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="flex-1 text-sm text-neutral-900 dark:text-neutral-100">{option.label}</span>
                {!isMulti && (selectedOption === i || highlightedIndex === i) && (
                  <svg className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                )}
              </button>
              {i < question.options.length && (
                <div className="mx-3 border-b border-neutral-100 dark:border-neutral-700/50" />
              )}
            </div>
          );
        })}
      </div>

      <div className="mx-3 border-b border-neutral-100 dark:border-neutral-700/50" />

      <div className="px-3 py-3">
        <div className="flex items-center gap-3 px-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-full border border-neutral-300 dark:border-neutral-600 shrink-0">
            <svg className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
            </svg>
          </span>
          <input
            ref={freeTextRef}
            type="text"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onFocus={() => {
              setIsFreeTextFocused(true);
              setHighlightedIndex(question.options.length);
            }}
            onBlur={() => setIsFreeTextFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleFreeTextSubmit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                freeTextRef.current?.blur();
                setIsFreeTextFocused(false);
                containerRef.current?.focus();
              }
            }}
            placeholder="Something else"
            className="flex-1 bg-transparent text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 px-5 pb-4">
        {isMulti && multiSelections.size > 0 && (
          <button
            onClick={handleMultiSubmit}
            className="px-4 py-1.5 text-xs font-medium text-white dark:text-neutral-900 bg-neutral-800 dark:bg-neutral-200 rounded-lg hover:bg-neutral-700 dark:hover:bg-neutral-300 transition-colors"
          >
            Submit ({multiSelections.size})
          </button>
        )}
        <button
          onClick={handleSkip}
          className="px-4 py-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400 border border-neutral-300 dark:border-neutral-600 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function getToolLabel(tool?: string): string {
  switch (tool) {
    case "read":
      return "Reading";
    case "glob":
      return "Searching";
    case "grep":
      return "Searching";
    case "bash":
      return "Running";
    case "repoSync":
      return "Fetching code";
    default:
      return "Running";
  }
}
