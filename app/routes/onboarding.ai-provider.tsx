import { Form, redirect, useActionData, useNavigation } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/onboarding.ai-provider";
import { requireActiveAuth } from "~/lib/auth.server";
import {
  getAIProviderConfig,
  saveAIProviderConfig,
  validateAnthropicKey,
  validateBedrockCredentials,
  type AIProvider,
} from "~/lib/ai-provider.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization) {
    return redirect("/");
  }

  if (user.membership?.role !== "owner") {
    return redirect("/");
  }

  if (user.organization.onboardingCompleted) {
    return redirect("/");
  }

  const config = await getAIProviderConfig(user.organization.id);
  if (config) {
    return redirect("/onboarding/github-app");
  }

  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization || user.membership?.role !== "owner") {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const provider = formData.get("provider") as AIProvider;

  if (!provider || (provider !== "anthropic" && provider !== "bedrock")) {
    return { error: "Please select a provider" };
  }

  if (provider === "anthropic") {
    const apiKey = (formData.get("anthropicApiKey") as string)?.trim();

    if (!apiKey) {
      return { error: "API key is required" };
    }

    if (!apiKey.startsWith("sk-ant-")) {
      return { error: "Invalid API key format" };
    }

    const validation = await validateAnthropicKey(apiKey);
    if (!validation.valid) {
      return { error: validation.error || "Invalid API key" };
    }

    await saveAIProviderConfig(user.organization.id, "anthropic", {
      anthropicApiKey: apiKey,
    });
  } else {
    const awsRegion = (formData.get("awsRegion") as string)?.trim();
    const awsAccessKeyId = (formData.get("awsAccessKeyId") as string)?.trim();
    const awsSecretAccessKey = (formData.get("awsSecretAccessKey") as string)?.trim();

    if (!awsRegion || !awsAccessKeyId || !awsSecretAccessKey) {
      return { error: "All AWS fields are required" };
    }

    const validation = await validateBedrockCredentials(awsRegion, awsAccessKeyId, awsSecretAccessKey);
    if (!validation.valid) {
      return { error: validation.error || "Invalid AWS credentials" };
    }

    await saveAIProviderConfig(user.organization.id, "bedrock", {
      awsRegion,
      awsAccessKeyId,
      awsSecretAccessKey,
    });
  }

  return redirect("/onboarding/github-app");
}

export default function OnboardingAIProvider() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const [provider, setProvider] = useState<AIProvider>("anthropic");

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-neutral-600 dark:text-neutral-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Configure AI Provider
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Choose how to connect to Claude AI.
          </p>
        </div>

        <Form method="post" className="space-y-6">
          {actionData?.error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {actionData.error}
            </div>
          )}

          <div className="space-y-3">
            <label
              className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                provider === "anthropic"
                  ? "border-neutral-900 dark:border-neutral-100 bg-neutral-50 dark:bg-neutral-800"
                  : "border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-600"
              }`}
            >
              <input
                type="radio"
                name="provider"
                value="anthropic"
                checked={provider === "anthropic"}
                onChange={() => setProvider("anthropic")}
                className="mt-1"
              />
              <div>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  Anthropic API
                </span>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Direct access using an API key from console.anthropic.com
                </p>
              </div>
            </label>

            <label
              className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                provider === "bedrock"
                  ? "border-neutral-900 dark:border-neutral-100 bg-neutral-50 dark:bg-neutral-800"
                  : "border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-600"
              }`}
            >
              <input
                type="radio"
                name="provider"
                value="bedrock"
                checked={provider === "bedrock"}
                onChange={() => setProvider("bedrock")}
                className="mt-1"
              />
              <div>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  AWS Bedrock
                </span>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Access Claude through your AWS account
                </p>
              </div>
            </label>
          </div>

          {provider === "anthropic" && (
            <div>
              <label
                htmlFor="anthropicApiKey"
                className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
              >
                API Key
              </label>
              <input
                type="password"
                id="anthropicApiKey"
                name="anthropicApiKey"
                required
                placeholder="sk-ant-..."
                className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
              />
              <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                Get your API key from{" "}
                <a
                  href="https://console.anthropic.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  console.anthropic.com
                </a>
              </p>
            </div>
          )}

          {provider === "bedrock" && (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="awsRegion"
                  className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
                >
                  AWS Region
                </label>
                <input
                  type="text"
                  id="awsRegion"
                  name="awsRegion"
                  required
                  placeholder="us-east-1"
                  className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                />
              </div>

              <div>
                <label
                  htmlFor="awsAccessKeyId"
                  className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
                >
                  Access Key ID
                </label>
                <input
                  type="text"
                  id="awsAccessKeyId"
                  name="awsAccessKeyId"
                  required
                  placeholder="AKIA..."
                  className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                />
              </div>

              <div>
                <label
                  htmlFor="awsSecretAccessKey"
                  className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
                >
                  Secret Access Key
                </label>
                <input
                  type="password"
                  id="awsSecretAccessKey"
                  name="awsSecretAccessKey"
                  required
                  className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-4 py-3 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Validating..." : "Continue"}
          </button>
        </Form>
      </div>
    </div>
  );
}
