import crypto from "node:crypto";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createBedrockAnthropic } from "@ai-sdk/amazon-bedrock/anthropic";
import type { LanguageModel } from "ai";
import { getAIProviderConfig } from "./ai-provider.server";
import { db } from "./db/index.server";
import { aiProviderConfigurations, members } from "./db/schema";
import { eq } from "drizzle-orm";

export interface ClaudeModel {
  id: string;
  displayName: string;
  createdAt: string;
}

interface ModelCache {
  models: ClaudeModel[];
  fetchedAt: number;
  provider: string;
  organizationId: string;
}

let modelCache: ModelCache | null = null;
const CACHE_TTL = 60 * 60 * 1000;

export function clearModelCache() {
  modelCache = null;
}

export const DEFAULT_MODEL_ID = "claude-opus-4-7";

export const TITLE_MODEL_ID = "claude-sonnet-4-6";

const FALLBACK_MODELS: ClaudeModel[] = [
  {
    id: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    createdAt: "2026-02-17T00:00:00Z",
  },
  {
    id: "claude-opus-4-6",
    displayName: "Claude Opus 4.6",
    createdAt: "2026-02-04T00:00:00Z",
  },
  {
    id: "claude-opus-4-5-20251101",
    displayName: "Claude Opus 4.5",
    createdAt: "2025-11-24T00:00:00Z",
  },
  {
    id: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    createdAt: "2025-10-15T00:00:00Z",
  },
  {
    id: "claude-sonnet-4-5-20250929",
    displayName: "Claude Sonnet 4.5",
    createdAt: "2025-09-29T00:00:00Z",
  },
  {
    id: "claude-opus-4-1-20250805",
    displayName: "Claude Opus 4.1",
    createdAt: "2025-08-05T00:00:00Z",
  },
  {
    id: "claude-opus-4-20250514",
    displayName: "Claude Opus 4",
    createdAt: "2025-05-22T00:00:00Z",
  },
  {
    id: "claude-sonnet-4-20250514",
    displayName: "Claude Sonnet 4",
    createdAt: "2025-05-22T00:00:00Z",
  },
  {
    id: "claude-3-haiku-20240307",
    displayName: "Claude Haiku 3",
    createdAt: "2024-03-07T00:00:00Z",
  },
];

export async function fetchModelsFromAnthropic(
  apiKey: string
): Promise<ClaudeModel[]> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

    if (!response.ok) {
      console.error("Failed to fetch models from Anthropic:", response.status);
      return FALLBACK_MODELS;
    }

    const data = await response.json();
    const models: ClaudeModel[] = [];

    for (const model of data.data || []) {
      if (
        model.id &&
        model.id.startsWith("claude-") &&
        !model.id.includes(":")
      ) {
        models.push({
          id: model.id,
          displayName: model.display_name || model.id,
          createdAt: model.created_at || new Date().toISOString(),
        });
      }
    }

    if (models.length === 0) {
      return FALLBACK_MODELS;
    }

    models.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return models;
  } catch (error) {
    console.error("Error fetching models from Anthropic:", error);
    return FALLBACK_MODELS;
  }
}

function signAwsRequest(
  method: string,
  host: string,
  canonicalUri: string,
  canonicalQuerystring: string,
  region: string,
  service: string,
  accessKeyId: string,
  secretAccessKey: string
): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-date";
  const payloadHash = crypto.createHash("sha256").update("").digest("hex");
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${crypto.createHash("sha256").update(canonicalRequest).digest("hex")}`;

  const kDate = crypto.createHmac("sha256", `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(service).digest();
  const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();

  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Host: host,
    "x-amz-date": amzDate,
    Authorization: authorizationHeader,
  };
}

export async function fetchModelsFromBedrock(
  region: string,
  accessKeyId: string,
  secretAccessKey: string
): Promise<ClaudeModel[]> {
  try {
    const service = "bedrock";
    const host = `${service}.${region}.amazonaws.com`;
    const canonicalUri = "/inference-profiles";
    const endpoint = `https://${host}${canonicalUri}`;

    const headers = signAwsRequest(
      "GET",
      host,
      canonicalUri,
      "",
      region,
      service,
      accessKeyId,
      secretAccessKey
    );

    const response = await fetch(endpoint, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      console.error("Failed to fetch inference profiles from Bedrock:", response.status);
      return FALLBACK_MODELS;
    }

    const data = await response.json();
    const models: ClaudeModel[] = [];

    for (const profile of data.inferenceProfileSummaries || []) {
      const profileId = profile.inferenceProfileId || "";
      if (profileId.includes("claude")) {
        models.push({
          id: profileId,
          displayName: profile.inferenceProfileName || profileId,
          createdAt: profile.createdAt || new Date().toISOString(),
        });
      }
    }

    if (models.length === 0) {
      return FALLBACK_MODELS;
    }

    models.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return models;
  } catch (error) {
    console.error("Error fetching inference profiles from Bedrock:", error);
    return FALLBACK_MODELS;
  }
}

export async function getAvailableClaudeModels(
  organizationId: string
): Promise<ClaudeModel[]> {
  const config = await getAIProviderConfig(organizationId);
  if (!config) {
    return FALLBACK_MODELS;
  }

  const now = Date.now();
  if (
    modelCache &&
    modelCache.organizationId === organizationId &&
    modelCache.provider === config.provider &&
    now - modelCache.fetchedAt < CACHE_TTL
  ) {
    return modelCache.models;
  }

  let models: ClaudeModel[];

  if (config.provider === "anthropic" && config.anthropicApiKey) {
    models = await fetchModelsFromAnthropic(config.anthropicApiKey);
  } else if (
    config.provider === "bedrock" &&
    config.awsRegion &&
    config.awsAccessKeyId &&
    config.awsSecretAccessKey
  ) {
    models = await fetchModelsFromBedrock(
      config.awsRegion,
      config.awsAccessKeyId,
      config.awsSecretAccessKey
    );
  } else {
    return FALLBACK_MODELS;
  }

  modelCache = {
    models,
    fetchedAt: now,
    provider: config.provider,
    organizationId,
  };

  return models;
}

export async function getModelConfig(
  organizationId: string
): Promise<{ availableModels: string[]; defaultModel: string } | null> {
  const result = await db
    .select({
      availableModels: aiProviderConfigurations.availableModels,
      defaultModel: aiProviderConfigurations.defaultModel,
    })
    .from(aiProviderConfigurations)
    .where(eq(aiProviderConfigurations.organizationId, organizationId))
    .limit(1);

  if (result.length === 0) return null;

  return {
    availableModels: (result[0].availableModels as string[]) || [
      DEFAULT_MODEL_ID,
    ],
    defaultModel: result[0].defaultModel || DEFAULT_MODEL_ID,
  };
}

export async function saveModelConfig(
  organizationId: string,
  availableModels: string[],
  defaultModel: string
): Promise<void> {
  await db
    .update(aiProviderConfigurations)
    .set({
      availableModels,
      defaultModel,
      updatedAt: new Date(),
    })
    .where(eq(aiProviderConfigurations.organizationId, organizationId));
}

export async function getUserPreferredModel(
  memberId: string
): Promise<string | null> {
  const result = await db
    .select({ preferredModel: members.preferredModel })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (result.length === 0) return null;
  return result[0].preferredModel;
}

export async function setUserPreferredModel(
  memberId: string,
  model: string
): Promise<void> {
  await db
    .update(members)
    .set({ preferredModel: model })
    .where(eq(members.id, memberId));
}

export async function getEffectiveModel(
  memberId: string,
  organizationId: string
): Promise<string> {
  const userPreferred = await getUserPreferredModel(memberId);
  const modelConfig = await getModelConfig(organizationId);

  if (!modelConfig) {
    const config = await getAIProviderConfig(organizationId);
    if (config?.provider === "bedrock") {
      const models = await getAvailableClaudeModels(organizationId);
      return models[0]?.id || DEFAULT_MODEL_ID;
    }
    return DEFAULT_MODEL_ID;
  }

  if (userPreferred && modelConfig.availableModels.includes(userPreferred)) {
    return userPreferred;
  }

  return modelConfig.defaultModel || DEFAULT_MODEL_ID;
}

export function getDisplayName(modelId: string): string {
  const model = FALLBACK_MODELS.find((m) => m.id === modelId);
  if (model) return model.displayName;

  let id = modelId;
  const bedrockPrefixMatch = id.match(/^(?:[\w-]+\.)*anthropic\./);
  if (bedrockPrefixMatch) {
    id = id.slice(bedrockPrefixMatch[0].length).replace(/-v\d+:\d+$/, "");
  }

  const match = id.match(/^claude-(\w+)-(\d+(?:-\d+)?)-/);
  if (match) {
    const variant = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    const version = match[2].replace("-", ".");
    return `Claude ${variant} ${version}`;
  }

  return modelId;
}

export const OPTIONAL_TOOLS = [
  { id: "bash", description: "Execute shell commands" },
  { id: "webfetch", description: "Fetch web page content" },
  { id: "websearch", description: "Search the web" },
];

const TOOL_NAME_MAP: Record<string, string> = {
  Bash: "bash",
  WebFetch: "webfetch",
  WebSearch: "websearch",
};

export async function getToolConfig(organizationId: string): Promise<string[]> {
  const baseTools = ["read", "glob", "grep", "askUserQuestion"];

  const result = await db
    .select({ allowedTools: aiProviderConfigurations.allowedTools })
    .from(aiProviderConfigurations)
    .where(eq(aiProviderConfigurations.organizationId, organizationId))
    .limit(1);

  const optionalTools =
    result.length > 0 && result[0].allowedTools
      ? (result[0].allowedTools as string[])
      : ["Bash"];

  const mapped = optionalTools.map((t) => TOOL_NAME_MAP[t] || t.toLowerCase());

  return [...baseTools, ...mapped];
}

export function createBedrockCompactionFetch(
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
) {
  const signingKeyCache = new Map<string, ArrayBuffer>();
  return async (
    url: RequestInfo | URL,
    options?: RequestInit,
  ): Promise<Response> => {
    if (options?.body && typeof options.body === "string") {
      const body = JSON.parse(options.body);
      if (body.context_management) {
        const betas = new Set<string>(body.anthropic_beta || []);
        betas.add("compact-2026-01-12");
        betas.add("context-management-2025-06-27");
        body.anthropic_beta = Array.from(betas);
        const newBody = JSON.stringify(body);

        const { AwsV4Signer } = await import("aws4fetch");
        const urlStr =
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.href
              : (url as Request).url;
        const signer = new AwsV4Signer({
          url: urlStr,
          method: "POST",
          headers: (options.headers ?? {}) as HeadersInit,
          body: newBody,
          region,
          accessKeyId,
          secretAccessKey,
          service: "bedrock",
          cache: signingKeyCache,
        });
        const signed = await signer.sign();
        return fetch(url, {
          ...options,
          body: newBody,
          headers: signed.headers,
        });
      }
    }
    return fetch(url, options);
  };
}

export async function getModel(
  memberId: string,
  organizationId: string,
): Promise<{ model: LanguageModel; modelId: string }> {
  const config = await getAIProviderConfig(organizationId);
  const modelId = await getEffectiveModel(memberId, organizationId);

  if (config?.provider === "bedrock" && config.awsRegion && config.awsAccessKeyId && config.awsSecretAccessKey) {
    const bedrock = createBedrockAnthropic({
      region: config.awsRegion,
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
      fetch: createBedrockCompactionFetch(
        config.awsRegion,
        config.awsAccessKeyId,
        config.awsSecretAccessKey,
      ),
    });
    return { model: bedrock(modelId), modelId };
  }

  const anthropic = createAnthropic({
    apiKey: config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "",
  });
  return { model: anthropic(modelId), modelId };
}

export async function getTitleGenerationModel(
  organizationId: string,
): Promise<LanguageModel> {
  const config = await getAIProviderConfig(organizationId);

  if (config?.provider === "bedrock" && config.awsRegion && config.awsAccessKeyId && config.awsSecretAccessKey) {
    const bedrock = createBedrockAnthropic({
      region: config.awsRegion,
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
    });
    return bedrock(TITLE_MODEL_ID);
  }

  const anthropic = createAnthropic({
    apiKey: config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "",
  });
  return anthropic(TITLE_MODEL_ID);
}

export async function saveToolConfig(
  organizationId: string,
  optionalTools: string[]
): Promise<void> {
  await db
    .update(aiProviderConfigurations)
    .set({
      allowedTools: optionalTools,
      updatedAt: new Date(),
    })
    .where(eq(aiProviderConfigurations.organizationId, organizationId));
}
