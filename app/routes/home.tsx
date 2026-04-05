import { Form, redirect, useOutletContext, useNavigate, useSearchParams } from "react-router";
import { useRef, useState, useCallback } from "react";
import type { Route } from "./+types/home";
import type { AppContext } from "./app-layout";
import { ConversationLayout } from "~/components/conversation-layout";
import { PromptInput, type PendingFile } from "~/components/prompt-input";
import { requireAuth } from "~/lib/auth.server";
import { db } from "~/lib/db/index.server";
import { conversations } from "~/lib/db/schema";
import { logAuditEvent } from "~/lib/audit.server";

export function meta() {
  return [
    { title: "Compiler" },
    { name: "description", content: "AI-powered project assistant" },
  ];
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireAuth(request);
  const formData = await request.formData();
  const prompt = formData.get("prompt")?.toString() || "";
  const blobIds = formData.get("blobIds")?.toString() || "";

  if (!prompt.trim() && !blobIds) {
    return { error: "Please enter a message" };
  }

  const id = crypto.randomUUID();
  const activeProjectId = formData.get("projectId")?.toString() || null;

  await db.insert(conversations).values({
    id,
    userId: user.id,
    title: "New Chat",
    projectId: activeProjectId,
  });

  if (user.organization) {
    await logAuditEvent(user.organization.id, user.id, "created conversation", { conversationId: id });
  }

  const params = new URLSearchParams();
  if (prompt.trim()) params.set("prompt", prompt);
  if (blobIds) params.set("blobIds", blobIds);

  return redirect(`/c/${id}?${params.toString()}`);
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
  const blobIdsInputRef = useRef<HTMLInputElement>(null);

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

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    if (blobIdsInputRef.current) {
      const ids = pendingFiles
        .map((f) => f.blobId)
        .filter((id): id is string => !!id)
        .join(",");
      blobIdsInputRef.current.value = ids;
    }
  }, [pendingFiles]);

  return (
    <div className="flex flex-col h-full items-center justify-center bg-neutral-50 dark:bg-neutral-900 px-4">
      <h1 className="text-3xl font-medium text-neutral-900 dark:text-neutral-100 mb-8">
        What can I help with?
      </h1>

      <Form ref={formRef} method="post" className="w-full max-w-3xl" onSubmit={handleSubmit}>
        <input type="hidden" name="projectId" value={activeProjectId || ""} />
        <input type="hidden" ref={blobIdsInputRef} name="blobIds" />
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
      </Form>

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
