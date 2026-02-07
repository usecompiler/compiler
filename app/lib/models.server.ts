import crypto from "node:crypto";
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

const FALLBACK_MODELS: ClaudeModel[] = [
  {
    id: "claude-sonnet-4-5-20250929",
    displayName: "Claude Sonnet 4.5",
    createdAt: "2025-09-29T00:00:00Z",
  },
  {
    id: "claude-opus-4-5-20251101",
    displayName: "Claude Opus 4.5",
    createdAt: "2025-11-01T00:00:00Z",
  },
  {
    id: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    createdAt: "2025-10-01T00:00:00Z",
  },
  {
    id: "claude-sonnet-4-20250514",
    displayName: "Claude Sonnet 4",
    createdAt: "2025-05-14T00:00:00Z",
  },
  {
    id: "claude-3-7-sonnet-20250219",
    displayName: "Claude 3.7 Sonnet",
    createdAt: "2025-02-19T00:00:00Z",
  },
  {
    id: "claude-3-5-sonnet-20241022",
    displayName: "Claude 3.5 Sonnet v2",
    createdAt: "2024-10-22T00:00:00Z",
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
      "claude-sonnet-4-20250514",
    ],
    defaultModel: result[0].defaultModel || "claude-sonnet-4-20250514",
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
      return models[0]?.id || "claude-sonnet-4-20250514";
    }
    return "claude-sonnet-4-20250514";
  }

  if (userPreferred && modelConfig.availableModels.includes(userPreferred)) {
    return userPreferred;
  }

  return modelConfig.defaultModel || "claude-sonnet-4-20250514";
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

export const REQUIRED_TOOLS = ["Read", "Glob", "Grep", "Task", "AskUserQuestion"];

export const OPTIONAL_TOOLS = [
  { id: "Bash", description: "Execute shell commands" },
  { id: "WebFetch", description: "Fetch web page content" },
  { id: "WebSearch", description: "Search the web" },
];

export async function getToolConfig(organizationId: string): Promise<string[]> {
  const result = await db
    .select({ allowedTools: aiProviderConfigurations.allowedTools })
    .from(aiProviderConfigurations)
    .where(eq(aiProviderConfigurations.organizationId, organizationId))
    .limit(1);

  const optionalTools =
    result.length > 0 && result[0].allowedTools
      ? (result[0].allowedTools as string[])
      : ["Bash"];

  return [...REQUIRED_TOOLS, ...optionalTools];
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
