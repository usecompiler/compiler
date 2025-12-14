import { Form, redirect, useNavigate, useNavigation, useOutletContext } from "react-router";
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
    { title: "Gist" },
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
  const navigate = useNavigate();
  const navigation = useNavigation();
  const { conversations, user, hasMore } = useOutletContext<AppContext>();

  const isCreating = navigation.state === "submitting";

  const handleSelectConversation = (id: string) => {
    navigate(`/c/${id}`);
  };

  const handleNewConversation = () => {
    navigate("/");
  };

  return (
    <ConversationLayout
      conversations={conversations}
      currentConversationId={null}
      onSelectConversation={handleSelectConversation}
      onNewConversation={handleNewConversation}
      user={user}
      hasMore={hasMore}
    >
      <HomePromptInput isCreating={isCreating} />
    </ConversationLayout>
  );
}

function HomePromptInput({ isCreating }: { isCreating: boolean }) {
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
          disabled={isCreating}
          autoFocus
        />
      </Form>
    </div>
  );
}
