import crypto from "node:crypto";
import { db } from "./db/index.server";
import { storageConfigurations } from "./db/schema";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "./encryption.server";

export interface StorageConfig {
  provider: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export async function getStorageConfig(
  organizationId: string
): Promise<StorageConfig | null> {
  const result = await db
    .select()
    .from(storageConfigurations)
    .where(eq(storageConfigurations.organizationId, organizationId))
    .limit(1);

  if (result.length === 0) return null;

  const config = result[0];
  return {
    provider: config.provider,
    bucket: config.bucket,
    region: config.region || "us-east-1",
    accessKeyId: decrypt(config.encryptedAccessKeyId, config.accessKeyIdIv),
    secretAccessKey: decrypt(config.encryptedSecretAccessKey, config.secretAccessKeyIv),
  };
}

export async function getStorageConfigPublic(
  organizationId: string
): Promise<{ provider: string; bucket: string; region: string | null } | null> {
  const result = await db
    .select({
      provider: storageConfigurations.provider,
      bucket: storageConfigurations.bucket,
      region: storageConfigurations.region,
    })
    .from(storageConfigurations)
    .where(eq(storageConfigurations.organizationId, organizationId))
    .limit(1);

  if (result.length === 0) return null;
  return result[0];
}

export async function saveStorageConfig(
  organizationId: string,
  config: {
    provider: string;
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  }
): Promise<void> {
  const accessKeyEncrypted = encrypt(config.accessKeyId);
  const secretKeyEncrypted = encrypt(config.secretAccessKey);

  const existing = await db
    .select({ id: storageConfigurations.id })
    .from(storageConfigurations)
    .where(eq(storageConfigurations.organizationId, organizationId))
    .limit(1);

  const values = {
    provider: config.provider,
    bucket: config.bucket,
    region: config.region,
    encryptedAccessKeyId: accessKeyEncrypted.ciphertext,
    accessKeyIdIv: accessKeyEncrypted.iv,
    encryptedSecretAccessKey: secretKeyEncrypted.ciphertext,
    secretAccessKeyIv: secretKeyEncrypted.iv,
    updatedAt: new Date(),
  };

  if (existing.length > 0) {
    await db
      .update(storageConfigurations)
      .set(values)
      .where(eq(storageConfigurations.organizationId, organizationId));
  } else {
    await db.insert(storageConfigurations).values({
      id: crypto.randomUUID(),
      organizationId,
      ...values,
    });
  }
}

export async function deleteStorageConfig(
  organizationId: string
): Promise<void> {
  await db
    .delete(storageConfigurations)
    .where(eq(storageConfigurations.organizationId, organizationId));
}

export function generatePresignedUrl(
  config: StorageConfig,
  key: string,
  expiresIn: number = 900
): string {
  const host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
  const canonicalUri = `/${key}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const algorithm = "AWS4-HMAC-SHA256";
  const service = "s3";
  const credentialScope = `${dateStamp}/${config.region}/${service}/aws4_request`;
  const credential = `${config.accessKeyId}/${credentialScope}`;

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": algorithm,
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  });
  queryParams.sort();
  const canonicalQueryString = queryParams.toString();

  const canonicalRequest = `GET\n${canonicalUri}\n${canonicalQueryString}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${crypto.createHash("sha256").update(canonicalRequest).digest("hex")}`;

  const kDate = crypto.createHmac("sha256", `AWS4${config.secretAccessKey}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(config.region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(service).digest();
  const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();

  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

function signS3Request(
  method: string,
  host: string,
  canonicalUri: string,
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
  payloadHash: string,
  contentType?: string
): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headerNames = ["host", "x-amz-content-sha256", "x-amz-date"];
  if (contentType) headerNames.push("content-type");
  headerNames.sort();

  const headersMap: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headersMap["content-type"] = contentType;

  const canonicalHeaders = headerNames.map((h) => `${h}:${headersMap[h]}`).join("\n") + "\n";
  const signedHeaders = headerNames.join(";");

  const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = "AWS4-HMAC-SHA256";
  const service = "s3";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${crypto.createHash("sha256").update(canonicalRequest).digest("hex")}`;

  const kDate = crypto.createHmac("sha256", `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(service).digest();
  const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();

  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const result: Record<string, string> = {
    Host: host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: authorizationHeader,
  };
  if (contentType) result["Content-Type"] = contentType;

  return result;
}

export async function uploadFile(
  config: StorageConfig,
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<void> {
  const host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
  const canonicalUri = `/${key}`;
  const payloadHash = crypto.createHash("sha256").update(buffer).digest("hex");

  const headers = signS3Request(
    "PUT",
    host,
    canonicalUri,
    config.region,
    config.accessKeyId,
    config.secretAccessKey,
    payloadHash,
    contentType
  );

  const response = await fetch(`https://${host}${canonicalUri}`, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Length": String(buffer.length),
    },
    body: new Uint8Array(buffer),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`S3 upload failed (${response.status}): ${text}`);
  }
}

export async function fetchFile(
  config: StorageConfig,
  key: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
  const canonicalUri = `/${key}`;
  const payloadHash = crypto.createHash("sha256").update("").digest("hex");

  const headers = signS3Request(
    "GET",
    host,
    canonicalUri,
    config.region,
    config.accessKeyId,
    config.secretAccessKey,
    payloadHash
  );

  const response = await fetch(`https://${host}${canonicalUri}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    throw new Error(`S3 fetch failed (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "application/octet-stream";

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
  };
}
