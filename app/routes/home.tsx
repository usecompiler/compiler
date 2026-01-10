import { Form, redirect, useOutletContext } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/home";
import type { AppContext } from "./app-layout";
import { ConversationLayout } from "~/components/conversation-layout";
import { PromptInput } from "~/components/prompt-input";
import { requireAuth } from "~/lib/auth.server";
import { db } from "~/lib/db/index.server";
import { conversations } from "~/lib/db/schema";

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

  if (!prompt.trim()) {
    return { error: "Please enter a message" };
  }

  const id = crypto.randomUUID();

  await db.insert(conversations).values({
    id,
    userId: user.id,
    title: "New Chat",
  });

  return redirect(`/c/${id}?prompt=${encodeURIComponent(prompt)}`);
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
    reviewRequests,
    availableModels,
    defaultModel,
    userPreferredModel,
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
      reviewRequests={reviewRequests}
      availableModels={availableModels}
      defaultModel={defaultModel}
      userPreferredModel={userPreferredModel}
      showHeaderBorder={false}
    >
      {impersonating ? (
        <ImpersonatingView name={impersonating.name} />
      ) : (
        <HomePromptInput />
      )}
    </ConversationLayout>
  );
}

function HomePromptInput() {
  const [input, setInput] = useState("");

  return (
    <div className="flex flex-col h-full items-center justify-center bg-neutral-50 dark:bg-neutral-900 px-4">
      <h1 className="text-3xl font-medium text-neutral-900 dark:text-neutral-100 mb-8">
        What can I help with?
      </h1>

      <Form method="post" className="w-full max-w-3xl">
        <PromptInput
          name="prompt"
          value={input}
          onChange={setInput}
          onSubmit={() => {}}
          autoFocus
        />
      </Form>
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
