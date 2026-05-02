import { useOutletContext, useNavigate, useSearchParams } from "react-router";
import { useRef, useState, useCallback } from "react";
import type { AppContext } from "./app-layout";
import { ConversationLayout } from "~/components/conversation-layout";
import { PromptInput, type PendingFile } from "~/components/prompt-input";

export interface NewConversationNavState {
  prompt?: string;
  blobIds?: string;
  projectId?: string;
}

export function meta() {
  return [
    { title: "Compiler" },
    { name: "description", content: "AI-powered project assistant" },
  ];
}

export default function Home() {
  const {
    conversations,
    user,
    hasMore,
    impersonating,
    orgMembers,
    isOwner,
    isAdmin,
    availableModels,
    defaultModel,
    userPreferredModel,
    hasStorageConfig,
    projects,
    activeProject,
    saasMode,
  } = useOutletContext<AppContext>();

  return (
    <ConversationLayout
      conversations={conversations}
      user={user}
      hasMore={hasMore}
      impersonating={impersonating}
      orgMembers={orgMembers}
      isOwner={isOwner}
      isAdmin={isAdmin}
      availableModels={availableModels}
      defaultModel={defaultModel}
      userPreferredModel={userPreferredModel}
      showHeaderBorder={false}
      projects={projects}
      activeProject={activeProject}
      saasMode={saasMode}
    >
      {impersonating ? (
        <ImpersonatingView name={impersonating.name} />
      ) : (
        <HomePromptInput hasStorageConfig={hasStorageConfig} activeProjectId={activeProject?.id} />
      )}
    </ConversationLayout>
  );
}

const suggestedPrompts = [
  "What changes have been made over the last week?",
  "What bugs were fixed recently?",
  "Walk me through one of the key features",
];

function HomePromptInput({ hasStorageConfig, activeProjectId }: { hasStorageConfig: boolean; activeProjectId?: string }) {
  const [searchParams] = useSearchParams();
  const [input, setInput] = useState(searchParams.get("prompt") || "");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const navigate = useNavigate();

  const handlePromptClick = (prompt: string) => {
    setInput(prompt);
    setTimeout(() => {
      formRef.current?.requestSubmit();
    }, 0);
  };

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
  }, [pendingFiles.length]);

  const handleRemoveFile = useCallback((index: number) => {
    setPendingFiles((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const promptText = input.trim();
    const blobIds = pendingFiles
      .map((f) => f.blobId)
      .filter((id): id is string => !!id)
      .join(",");

    if (!promptText && !blobIds) return;

    const id = crypto.randomUUID();
    navigate(`/c/${id}`, {
      state: {
        prompt: promptText || undefined,
        blobIds: blobIds || undefined,
        projectId: activeProjectId || undefined,
      },
    });
  }, [input, pendingFiles, activeProjectId, navigate]);

  return (
    <div className="flex flex-col h-full items-center justify-center bg-neutral-50 dark:bg-neutral-900 px-4">
      <h1 className="text-3xl font-medium text-neutral-900 dark:text-neutral-100 mb-8">
        What can I help with?
      </h1>

      <form ref={formRef} className="w-full max-w-3xl" onSubmit={handleSubmit}>
        <PromptInput
          name="prompt"
          value={input}
          onChange={setInput}
          onSubmit={() => {}}
          autoFocus
          files={pendingFiles}
          onFilesChange={hasStorageConfig ? handleFilesChange : undefined}
          onRemoveFile={hasStorageConfig ? handleRemoveFile : undefined}
        />
      </form>

      <div className="flex flex-wrap justify-center gap-2 mt-6 max-w-3xl">
        {suggestedPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => handlePromptClick(prompt)}
            className="px-3 py-1.5 text-sm text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-full transition-colors cursor-pointer"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function ImpersonatingView({ name }: { name: string }) {
  return (
    <div className="flex flex-col h-full items-center justify-center bg-neutral-50 dark:bg-neutral-900 px-4">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-orange-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
        </div>
        <h1 className="text-2xl font-medium text-neutral-900 dark:text-neutral-100 mb-2">
          Impersonating {name}
        </h1>
        <p className="text-neutral-500 dark:text-neutral-400">
          Select a conversation from the sidebar to view
        </p>
      </div>
    </div>
  );
}
