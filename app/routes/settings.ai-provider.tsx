import type { Route } from "./+types/settings.ai-provider";
import { Form, Link, redirect, useActionData, useFetcher } from "react-router";
import { useState, useEffect } from "react";
import { requireActiveAuth } from "~/lib/auth.server";
import {
  getAIProviderConfig,
  saveAIProviderConfig,
  validateAnthropicKey,
  validateBedrockCredentials,
  type AIProvider,
} from "~/lib/ai-provider.server";
import {
  getAvailableClaudeModels,
  getModelConfig,
  saveModelConfig,
  getToolConfig,
  saveToolConfig,
  REQUIRED_TOOLS as SERVER_REQUIRED_TOOLS,
  OPTIONAL_TOOLS as SERVER_OPTIONAL_TOOLS,
} from "~/lib/models.server";
import { canManageOrganization } from "~/lib/permissions.server";

const REQUIRED_TOOLS = ["Read", "Glob", "Grep", "Task"];

const OPTIONAL_TOOLS = [
  { id: "Bash", description: "Execute shell commands" },
  { id: "WebFetch", description: "Fetch web page content" },
  { id: "WebSearch", description: "Search the web" },
];

interface ModelOption {
  id: string;
  displayName: string;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!canManageOrganization(user.membership?.role)) {
    throw redirect("/settings");
  }

  if (!user.organization) {
    return { config: null, availableModels: [], modelConfig: null, enabledTools: ["Bash"] };
  }

  const config = await getAIProviderConfig(user.organization.id);

  if (!config) {
    return { config: null, availableModels: [], modelConfig: null, enabledTools: ["Bash"] };
  }

  const [apiModels, modelConfig, toolConfig] = await Promise.all([
    getAvailableClaudeModels(user.organization.id),
    getModelConfig(user.organization.id),
    getToolConfig(user.organization.id),
  ]);

  const enabledOptionalTools = toolConfig.filter((t) => !SERVER_REQUIRED_TOOLS.includes(t));

  return {
    config: {
      provider: config.provider,
      awsRegion: config.awsRegion || null,
      promptCachingEnabled: config.promptCachingEnabled ?? true,
    },
    availableModels: apiModels,
    modelConfig,
    enabledTools: enabledOptionalTools,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization || !canManageOrganization(user.membership?.role)) {
    return { error: "Unauthorized", success: false, intent: "" };
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save-models") {
    const selectedModels = formData.getAll("selectedModels") as string[];
    const defaultModel = formData.get("defaultModel") as string;

    if (selectedModels.length === 0) {
      return { error: "At least one model must be selected", success: false, intent };
    }

    if (!defaultModel || !selectedModels.includes(defaultModel)) {
      return { error: "Default model must be one of the selected models", success: false, intent };
    }

    await saveModelConfig(user.organization.id, selectedModels, defaultModel);
    return { error: null, success: true, intent };
  }

  if (intent === "save-tools") {
    const selectedTools = formData.getAll("selectedTools") as string[];
    const validTools = selectedTools.filter((t) =>
      SERVER_OPTIONAL_TOOLS.some((ot) => ot.id === t)
    );
    await saveToolConfig(user.organization.id, validTools);
    return { error: null, success: true, intent };
  }

  const provider = formData.get("provider") as AIProvider;

  if (!provider || (provider !== "anthropic" && provider !== "bedrock")) {
    return { error: "Please select a provider", success: false, intent: "save-provider" };
  }

  if (provider === "anthropic") {
    const apiKey = (formData.get("anthropicApiKey") as string)?.trim();

    if (!apiKey) {
      return { error: "API key is required", success: false, intent: "save-provider" };
    }

    if (!apiKey.startsWith("sk-ant-")) {
      return { error: "Invalid API key format", success: false, intent: "save-provider" };
    }

    const validation = await validateAnthropicKey(apiKey);
    if (!validation.valid) {
      return { error: validation.error || "Invalid API key", success: false, intent: "save-provider" };
    }

    await saveAIProviderConfig(user.organization.id, "anthropic", {
      anthropicApiKey: apiKey,
    });
  } else {
    const awsRegion = (formData.get("awsRegion") as string)?.trim();
    const awsAccessKeyId = (formData.get("awsAccessKeyId") as string)?.trim();
    const awsSecretAccessKey = (formData.get("awsSecretAccessKey") as string)?.trim();

    if (!awsRegion || !awsAccessKeyId || !awsSecretAccessKey) {
      return { error: "All AWS fields are required", success: false, intent: "save-provider" };
    }

    const validation = await validateBedrockCredentials(awsRegion, awsAccessKeyId, awsSecretAccessKey);
    if (!validation.valid) {
      return { error: validation.error || "Invalid AWS credentials", success: false, intent: "save-provider" };
    }

    const promptCachingEnabled = formData.get("promptCaching") === "true";

    await saveAIProviderConfig(user.organization.id, "bedrock", {
      awsRegion,
      awsAccessKeyId,
      awsSecretAccessKey,
      promptCachingEnabled,
    });
  }

  return { error: null, success: true, intent: "save-provider" };
}

export default function AIProviderSettings({ loaderData }: Route.ComponentProps) {
  const { config, availableModels, modelConfig, enabledTools } = loaderData;
  const actionData = useActionData<typeof action>();
  const [showEdit, setShowEdit] = useState(!config);
  const [provider, setProvider] = useState<AIProvider>(config?.provider || "anthropic");
  const [selectedModels, setSelectedModels] = useState<string[]>(
    modelConfig?.availableModels || ["claude-sonnet-4-20250514"]
  );
  const [defaultModel, setDefaultModel] = useState<string>(
    modelConfig?.defaultModel || "claude-sonnet-4-20250514"
  );
  const [selectedTools, setSelectedTools] = useState<string[]>(enabledTools);

  useEffect(() => {
    if (actionData?.success && actionData?.intent === "save-provider") {
      setShowEdit(false);
    }
  }, [actionData]);

  const handleModelToggle = (modelId: string) => {
    setSelectedModels((prev) => {
      if (prev.includes(modelId)) {
        const newModels = prev.filter((m) => m !== modelId);
        if (defaultModel === modelId && newModels.length > 0) {
          setDefaultModel(newModels[0]);
        }
        return newModels;
      }
      return [...prev, modelId];
    });
  };

  const handleToolToggle = (toolId: string) => {
    setSelectedTools((prev) => {
      if (prev.includes(toolId)) {
        return prev.filter((t) => t !== toolId);
      }
      return [...prev, toolId];
    });
  };

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

          {actionData?.intent === "save-provider" && actionData?.error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {actionData.error}
            </div>
          )}

          {actionData?.intent === "save-provider" && actionData?.success && (
            <div className="mb-4 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 text-sm text-green-600 dark:text-green-400">
              Configuration saved successfully
            </div>
          )}

          {showEdit ? (
            <Form method="post" className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4 space-y-4">
              <input type="hidden" name="intent" value="save-provider" />
              <div className="space-y-3">
                <label
                  className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${provider === "anthropic"
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
                  className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${provider === "bedrock"
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

                  <label className="flex items-center gap-3 p-3 border border-neutral-200 dark:border-neutral-600 rounded-lg cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors">
                    <input
                      type="checkbox"
                      name="promptCaching"
                      value="true"
                      defaultChecked={config?.promptCachingEnabled ?? true}
                      className="w-4 h-4"
                    />
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">
                      Prompt Caching
                    </span>
                  </label>
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

        {config && availableModels.length > 0 && (
          <section className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                Model Availability
              </h2>
            </div>

            <Form method="post" className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4 space-y-4">
              <input type="hidden" name="intent" value="save-models" />

              <div>
                <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-3">
                  Select which models are available to users:
                </p>
                <div className="space-y-2">
                  {availableModels.map((model: ModelOption) => (
                    <label
                      key={model.id}
                      className="flex items-center gap-3 p-3 border border-neutral-200 dark:border-neutral-600 rounded-lg cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
                    >
                      <input
                        type="checkbox"
                        name="selectedModels"
                        value={model.id}
                        checked={selectedModels.includes(model.id)}
                        onChange={() => handleModelToggle(model.id)}
                        className="w-4 h-4"
                      />
                      <div className="flex-1">
                        <span className="font-medium text-neutral-900 dark:text-neutral-100">
                          {model.displayName}
                        </span>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 font-mono">
                          {model.id}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  Default Model
                </label>
                <select
                  name="defaultModel"
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                >
                  {selectedModels.map((modelId) => {
                    const model = availableModels.find((m: ModelOption) => m.id === modelId);
                    return (
                      <option key={modelId} value={modelId}>
                        {model?.displayName || modelId}
                      </option>
                    );
                  })}
                </select>
                <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                  The default model for new users
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={selectedModels.length === 0}
                  className="px-4 py-2 text-sm font-medium bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Model Settings
                </button>
                {actionData?.intent === "save-models" && actionData?.success && (
                  <span className="text-sm text-green-600 dark:text-green-400">Saved</span>
                )}
                {actionData?.intent === "save-models" && actionData?.error && (
                  <span className="text-sm text-red-600 dark:text-red-400">{actionData.error}</span>
                )}
              </div>
            </Form>
          </section>
        )}

        {config && (
          <section className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                Agent Tools
              </h2>
            </div>

            <Form method="post" className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4 space-y-4">
              <input type="hidden" name="intent" value="save-tools" />

              <div>
                <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-3">
                  Required tools (always enabled):
                </p>
                <div className="space-y-2 mb-4">
                  {REQUIRED_TOOLS.map((tool) => (
                    <label
                      key={tool}
                      className="flex items-center gap-3 p-3 border border-neutral-200 dark:border-neutral-600 rounded-lg bg-neutral-50 dark:bg-neutral-700/50"
                    >
                      <input
                        type="checkbox"
                        checked={true}
                        disabled
                        className="w-4 h-4 opacity-50"
                      />
                      <div className="flex-1">
                        <span className="font-medium text-neutral-900 dark:text-neutral-100">
                          {tool}
                        </span>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                          {tool === "Read" && "Read file contents"}
                          {tool === "Glob" && "Find files by pattern"}
                          {tool === "Grep" && "Search file contents"}
                          {tool === "Task" && "Spawn subagents for focused tasks"}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>

                <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-3">
                  Optional tools:
                </p>
                <div className="space-y-2">
                  {OPTIONAL_TOOLS.map((tool) => (
                    <label
                      key={tool.id}
                      className="flex items-center gap-3 p-3 border border-neutral-200 dark:border-neutral-600 rounded-lg cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
                    >
                      <input
                        type="checkbox"
                        name="selectedTools"
                        value={tool.id}
                        checked={selectedTools.includes(tool.id)}
                        onChange={() => handleToolToggle(tool.id)}
                        className="w-4 h-4"
                      />
                      <div className="flex-1">
                        <span className="font-medium text-neutral-900 dark:text-neutral-100">
                          {tool.id}
                        </span>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                          {tool.description}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
                >
                  Save Tool Settings
                </button>
                {actionData?.intent === "save-tools" && actionData?.success && (
                  <span className="text-sm text-green-600 dark:text-green-400">Saved</span>
                )}
                {actionData?.intent === "save-tools" && actionData?.error && (
                  <span className="text-sm text-red-600 dark:text-red-400">{actionData.error}</span>
                )}
              </div>
            </Form>
          </section>
        )}
      </main>
    </div>
  );
}
