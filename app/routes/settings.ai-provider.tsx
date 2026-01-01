import type { Route } from "./+types/settings.ai-provider";
import { Form, Link, redirect, useActionData } from "react-router";
import { useState, useEffect } from "react";
import { requireActiveAuth } from "~/lib/auth.server";
import {
  getAIProviderConfig,
  saveAIProviderConfig,
  validateAnthropicKey,
  validateBedrockCredentials,
  type AIProvider,
} from "~/lib/ai-provider.server";
import { canManageOrganization } from "~/lib/permissions.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!canManageOrganization(user.membership?.role)) {
    throw redirect("/settings");
  }

  if (!user.organization) {
    return { config: null };
  }

  const config = await getAIProviderConfig(user.organization.id);

  if (!config) {
    return { config: null };
  }

  return {
    config: {
      provider: config.provider,
      awsRegion: config.awsRegion || null,
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization || !canManageOrganization(user.membership?.role)) {
    return { error: "Unauthorized", success: false };
  }

  const formData = await request.formData();
  const provider = formData.get("provider") as AIProvider;

  if (!provider || (provider !== "anthropic" && provider !== "bedrock")) {
    return { error: "Please select a provider", success: false };
  }

  if (provider === "anthropic") {
    const apiKey = (formData.get("anthropicApiKey") as string)?.trim();

    if (!apiKey) {
      return { error: "API key is required", success: false };
    }

    if (!apiKey.startsWith("sk-ant-")) {
      return { error: "Invalid API key format", success: false };
    }

    const validation = await validateAnthropicKey(apiKey);
    if (!validation.valid) {
      return { error: validation.error || "Invalid API key", success: false };
    }

    await saveAIProviderConfig(user.organization.id, "anthropic", {
      anthropicApiKey: apiKey,
    });
  } else {
    const awsRegion = (formData.get("awsRegion") as string)?.trim();
    const awsAccessKeyId = (formData.get("awsAccessKeyId") as string)?.trim();
    const awsSecretAccessKey = (formData.get("awsSecretAccessKey") as string)?.trim();

    if (!awsRegion || !awsAccessKeyId || !awsSecretAccessKey) {
      return { error: "All AWS fields are required", success: false };
    }

    const validation = await validateBedrockCredentials(awsRegion, awsAccessKeyId, awsSecretAccessKey);
    if (!validation.valid) {
      return { error: validation.error || "Invalid AWS credentials", success: false };
    }

    await saveAIProviderConfig(user.organization.id, "bedrock", {
      awsRegion,
      awsAccessKeyId,
      awsSecretAccessKey,
    });
  }

  return { error: null, success: true };
}

export default function AIProviderSettings({ loaderData }: Route.ComponentProps) {
  const { config } = loaderData;
  const actionData = useActionData<typeof action>();
  const [showEdit, setShowEdit] = useState(!config);
  const [provider, setProvider] = useState<AIProvider>(config?.provider || "anthropic");

  useEffect(() => {
    if (actionData?.success) {
      setShowEdit(false);
    }
  }, [actionData]);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/"
            className="p-2 -ml-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
              />
            </svg>
          </Link>
          <h1 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
            Settings
          </h1>
        </div>
      </header>

      <div className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4">
          <nav className="flex gap-6">
            <Link
              to="/settings"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Account
            </Link>
            <span className="py-3 text-sm text-neutral-900 dark:text-neutral-100 font-medium border-b-2 border-neutral-900 dark:border-neutral-100">
              AI Provider
            </span>
            <Link
              to="/settings/authentication"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Authentication
            </Link>
            <Link
              to="/settings/github"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              GitHub
            </Link>
            <Link
              to="/settings/organization"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Organization
            </Link>
          </nav>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
              AI Provider Configuration
            </h2>
            {config && (
              <button
                type="button"
                onClick={() => setShowEdit(!showEdit)}
                className="text-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                {showEdit ? "Cancel" : "Edit"}
              </button>
            )}
          </div>

          {actionData?.error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {actionData.error}
            </div>
          )}

          {actionData?.success && (
            <div className="mb-4 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 text-sm text-green-600 dark:text-green-400">
              Configuration saved successfully
            </div>
          )}

          {showEdit ? (
            <Form method="post" className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4 space-y-4">
              <div className="space-y-3">
                <label
                  className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    provider === "anthropic"
                      ? "border-neutral-900 dark:border-neutral-100 bg-neutral-50 dark:bg-neutral-700"
                      : "border-neutral-300 dark:border-neutral-600 hover:border-neutral-400 dark:hover:border-neutral-500"
                  }`}
                >
                  <input
                    type="radio"
                    name="provider"
                    value="anthropic"
                    checked={provider === "anthropic"}
                    onChange={() => setProvider("anthropic")}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">
                      Anthropic API
                    </span>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      Direct access using an API key
                    </p>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    provider === "bedrock"
                      ? "border-neutral-900 dark:border-neutral-100 bg-neutral-50 dark:bg-neutral-700"
                      : "border-neutral-300 dark:border-neutral-600 hover:border-neutral-400 dark:hover:border-neutral-500"
                  }`}
                >
                  <input
                    type="radio"
                    name="provider"
                    value="bedrock"
                    checked={provider === "bedrock"}
                    onChange={() => setProvider("bedrock")}
                    className="mt-0.5"
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
                  <label htmlFor="anthropicApiKey" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                    API Key
                  </label>
                  <input
                    type="password"
                    id="anthropicApiKey"
                    name="anthropicApiKey"
                    required
                    placeholder="sk-ant-..."
                    className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                  />
                  <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                    {config ? "Enter new API key to update" : "Get your API key from console.anthropic.com"}
                  </p>
                </div>
              )}

              {provider === "bedrock" && (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="awsRegion" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                      AWS Region
                    </label>
                    <input
                      type="text"
                      id="awsRegion"
                      name="awsRegion"
                      required
                      placeholder="us-east-1"
                      defaultValue={config?.awsRegion || ""}
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="awsAccessKeyId" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                      Access Key ID
                    </label>
                    <input
                      type="text"
                      id="awsAccessKeyId"
                      name="awsAccessKeyId"
                      required
                      placeholder="AKIA..."
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="awsSecretAccessKey" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                      Secret Access Key
                    </label>
                    <input
                      type="password"
                      id="awsSecretAccessKey"
                      name="awsSecretAccessKey"
                      required
                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                    />
                    <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                      {config ? "Enter credentials to update" : "AWS credentials with Bedrock access"}
                    </p>
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
              >
                {config ? "Update Configuration" : "Save Configuration"}
              </button>
            </Form>
          ) : config ? (
            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">Provider</span>
                  <p className="text-neutral-900 dark:text-neutral-100">
                    {config.provider === "anthropic" ? "Anthropic API" : "AWS Bedrock"}
                  </p>
                </div>
                {config.provider === "bedrock" && config.awsRegion && (
                  <div>
                    <span className="text-neutral-500 dark:text-neutral-400">Region</span>
                    <p className="text-neutral-900 dark:text-neutral-100 font-mono">{config.awsRegion}</p>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
