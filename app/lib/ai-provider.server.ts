import crypto from "node:crypto";
import { db } from "./db/index.server";
import { aiProviderConfigurations } from "./db/schema";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "./encryption.server";

export type AIProvider = "anthropic" | "bedrock";

export interface AIProviderConfig {
  provider: AIProvider;
  anthropicApiKey?: string;
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
}

export async function getAIProviderConfig(
  organizationId: string
): Promise<AIProviderConfig | null> {
  const result = await db
    .select()
    .from(aiProviderConfigurations)
    .where(eq(aiProviderConfigurations.organizationId, organizationId))
    .limit(1);

  if (result.length === 0) return null;

  const config = result[0];

  if (config.provider === "anthropic") {
    if (!config.encryptedAnthropicApiKey || !config.anthropicApiKeyIv) {
      return null;
    }
    return {
      provider: "anthropic",
      anthropicApiKey: decrypt(config.encryptedAnthropicApiKey, config.anthropicApiKeyIv),
    };
  }

  if (config.provider === "bedrock") {
    if (
      !config.awsRegion ||
      !config.encryptedAwsAccessKeyId ||
      !config.awsAccessKeyIdIv ||
      !config.encryptedAwsSecretAccessKey ||
      !config.awsSecretAccessKeyIv
    ) {
      return null;
    }
    return {
      provider: "bedrock",
      awsRegion: config.awsRegion,
      awsAccessKeyId: decrypt(config.encryptedAwsAccessKeyId, config.awsAccessKeyIdIv),
      awsSecretAccessKey: decrypt(config.encryptedAwsSecretAccessKey, config.awsSecretAccessKeyIv),
    };
  }

  return null;
}

export async function saveAIProviderConfig(
  organizationId: string,
  provider: AIProvider,
  credentials: {
    anthropicApiKey?: string;
    awsRegion?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
  }
): Promise<void> {
  const existing = await db
    .select()
    .from(aiProviderConfigurations)
    .where(eq(aiProviderConfigurations.organizationId, organizationId))
    .limit(1);

  let values: Record<string, unknown> = {
    provider,
    updatedAt: new Date(),
  };

  if (provider === "anthropic" && credentials.anthropicApiKey) {
    const { ciphertext, iv } = encrypt(credentials.anthropicApiKey);
    values = {
      ...values,
      encryptedAnthropicApiKey: ciphertext,
      anthropicApiKeyIv: iv,
      awsRegion: null,
      encryptedAwsAccessKeyId: null,
      awsAccessKeyIdIv: null,
      encryptedAwsSecretAccessKey: null,
      awsSecretAccessKeyIv: null,
    };
  } else if (
    provider === "bedrock" &&
    credentials.awsRegion &&
    credentials.awsAccessKeyId &&
    credentials.awsSecretAccessKey
  ) {
    const accessKeyEncrypted = encrypt(credentials.awsAccessKeyId);
    const secretKeyEncrypted = encrypt(credentials.awsSecretAccessKey);
    values = {
      ...values,
      encryptedAnthropicApiKey: null,
      anthropicApiKeyIv: null,
      awsRegion: credentials.awsRegion,
      encryptedAwsAccessKeyId: accessKeyEncrypted.ciphertext,
      awsAccessKeyIdIv: accessKeyEncrypted.iv,
      encryptedAwsSecretAccessKey: secretKeyEncrypted.ciphertext,
      awsSecretAccessKeyIv: secretKeyEncrypted.iv,
    };
  }

  if (existing.length > 0) {
    await db
      .update(aiProviderConfigurations)
      .set(values)
      .where(eq(aiProviderConfigurations.organizationId, organizationId));
  } else {
    await db.insert(aiProviderConfigurations).values({
      id: crypto.randomUUID(),
      organizationId,
      provider,
      ...values,
    });
  }
}

export async function validateAnthropicKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    if (response.status === 401) {
      return { valid: false, error: "Invalid API key" };
    }

    if (response.status === 400 || response.status === 200) {
      return { valid: true };
    }

    return { valid: false, error: `Unexpected response: ${response.status}` };
  } catch (error) {
    return { valid: false, error: "Failed to validate API key" };
  }
}

export async function validateBedrockCredentials(
  region: string,
  accessKeyId: string,
  secretAccessKey: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const service = "bedrock";
    const host = `${service}.${region}.amazonaws.com`;
    const endpoint = `https://${host}/foundation-models`;
    const method = "GET";
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);

    const canonicalUri = "/foundation-models";
    const canonicalQuerystring = "";
    const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-date";
    const payloadHash = crypto.createHash("sha256").update("").digest("hex");
    const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const algorithm = "AWS4-HMAC-SHA256";
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${crypto.createHash("sha256").update(canonicalRequest).digest("hex")}`;

    const getSignatureKey = (key: string, dateStamp: string, regionName: string, serviceName: string) => {
      const kDate = crypto.createHmac("sha256", `AWS4${key}`).update(dateStamp).digest();
      const kRegion = crypto.createHmac("sha256", kDate).update(regionName).digest();
      const kService = crypto.createHmac("sha256", kRegion).update(serviceName).digest();
      const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();
      return kSigning;
    };

    const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(endpoint, {
      method,
      headers: {
        "Host": host,
        "x-amz-date": amzDate,
        "Authorization": authorizationHeader,
      },
    });

    if (response.status === 403 || response.status === 401) {
      return { valid: false, error: "Invalid AWS credentials" };
    }

    if (response.status === 200) {
      return { valid: true };
    }

    return { valid: false, error: `Unexpected response: ${response.status}` };
  } catch (error) {
    return { valid: false, error: "Failed to validate AWS credentials" };
  }
}

export async function getAIProviderEnv(
  organizationId: string
): Promise<Record<string, string>> {
  const config = await getAIProviderConfig(organizationId);
  if (!config) {
    return {};
  }

  if (config.provider === "anthropic" && config.anthropicApiKey) {
    return {
      ANTHROPIC_API_KEY: config.anthropicApiKey,
    };
  }

  if (
    config.provider === "bedrock" &&
    config.awsRegion &&
    config.awsAccessKeyId &&
    config.awsSecretAccessKey
  ) {
    return {
      CLAUDE_CODE_USE_BEDROCK: "1",
      AWS_REGION: config.awsRegion,
      AWS_ACCESS_KEY_ID: config.awsAccessKeyId,
      AWS_SECRET_ACCESS_KEY: config.awsSecretAccessKey,
    };
  }

  return {};
}
