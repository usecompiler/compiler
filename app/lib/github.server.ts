import crypto from "node:crypto";
import { db } from "./db/index.server";
import { githubInstallations } from "./db/schema";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "./encryption.server";

const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  cloneUrl: string;
  private: boolean;
  defaultBranch: string;
}

function getAppId(): string {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) {
    throw new Error("GITHUB_APP_ID environment variable is required");
  }
  return appId;
}

function getPrivateKey(): string {
  const key = process.env.GITHUB_PRIVATE_KEY;
  if (!key) {
    throw new Error("GITHUB_PRIVATE_KEY environment variable is required");
  }
  return key.replace(/\\n/g, "\n");
}

function base64url(input: Buffer | string): string {
  const str = typeof input === "string" ? input : input.toString("base64");
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function generateAppJWT(): string {
  const appId = getAppId();
  const privateKey = getPrivateKey();

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: appId,
  };

  const header = { alg: "RS256", typ: "JWT" };
  const encodedHeader = base64url(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64url(Buffer.from(JSON.stringify(payload)));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signatureInput);
  const signature = sign.sign(privateKey);

  return `${signatureInput}.${base64url(signature)}`;
}

export async function getInstallationAccessToken(
  installationId: string
): Promise<{ token: string; expiresAt: Date }> {
  const jwt = generateAppJWT();

  const response = await fetch(
    `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get installation access token: ${error}`);
  }

  const data = await response.json();
  return {
    token: data.token,
    expiresAt: new Date(data.expires_at),
  };
}

export async function listInstallationRepos(accessToken: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(
      `${GITHUB_API_BASE}/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${accessToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list repositories: ${error}`);
    }

    const data = await response.json();
    for (const repo of data.repositories) {
      repos.push({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        cloneUrl: repo.clone_url,
        private: repo.private,
        defaultBranch: repo.default_branch,
      });
    }

    hasMore = data.repositories.length === 100;
    page++;
  }

  return repos;
}

export function getAuthenticatedCloneUrl(cloneUrl: string, accessToken: string): string {
  const url = new URL(cloneUrl);
  url.username = "x-access-token";
  url.password = accessToken;
  return url.toString();
}

export async function saveInstallation(
  organizationId: string,
  installationId: string,
  accessToken: string,
  expiresAt: Date
): Promise<void> {
  const { ciphertext, iv } = encrypt(accessToken);

  const existing = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.organizationId, organizationId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(githubInstallations)
      .set({
        installationId,
        encryptedAccessToken: ciphertext,
        accessTokenIv: iv,
        accessTokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(githubInstallations.organizationId, organizationId));
  } else {
    await db.insert(githubInstallations).values({
      id: crypto.randomUUID(),
      organizationId,
      installationId,
      encryptedAccessToken: ciphertext,
      accessTokenIv: iv,
      accessTokenExpiresAt: expiresAt,
    });
  }
}

export async function getInstallation(organizationId: string): Promise<{
  installationId: string;
  accessToken: string;
  expiresAt: Date;
} | null> {
  const result = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.organizationId, organizationId))
    .limit(1);

  if (result.length === 0) return null;

  const installation = result[0];
  if (!installation.encryptedAccessToken || !installation.accessTokenIv) {
    return null;
  }

  const accessToken = decrypt(installation.encryptedAccessToken, installation.accessTokenIv);

  return {
    installationId: installation.installationId,
    accessToken,
    expiresAt: installation.accessTokenExpiresAt!,
  };
}

export async function getOrRefreshAccessToken(organizationId: string): Promise<string | null> {
  const installation = await getInstallation(organizationId);
  if (!installation) return null;

  const bufferTime = 5 * 60 * 1000;
  if (installation.expiresAt.getTime() - Date.now() > bufferTime) {
    return installation.accessToken;
  }

  const { token, expiresAt } = await getInstallationAccessToken(installation.installationId);
  await saveInstallation(organizationId, installation.installationId, token, expiresAt);
  return token;
}

export function getGitHubAppInstallUrl(): string {
  const appId = getAppId();
  return `https://github.com/apps/${process.env.GITHUB_APP_SLUG || appId}/installations/new`;
}

export function getGitHubAppConfigureUrl(): string {
  return `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new`;
}
