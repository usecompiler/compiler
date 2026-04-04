import crypto from "node:crypto";
import { db } from "./db/index.server";
import { githubInstallations, githubAppConfigurations } from "./db/schema";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "./encryption.server";
import { isSaas } from "./appMode.server";

const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  cloneUrl: string;
  private: boolean;
  defaultBranch: string;
}

export interface GitHubAppInstallation {
  id: number;
  account: {
    login: string;
    id: number;
    type: string;
  };
  repositorySelection: "all" | "selected";
}

export interface GitHubAppConfig {
  appId: string;
  appSlug: string;
  privateKey: string;
}

function getSharedGitHubAppConfig(): GitHubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID;
  const appSlug = process.env.GITHUB_APP_SLUG;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !appSlug || !privateKey) return null;

  return { appId, appSlug, privateKey: privateKey.replace(/\\+n/g, "\n") };
}

export async function getGitHubAppConfig(
  organizationId: string
): Promise<GitHubAppConfig | null> {
  if (isSaas()) {
    return getSharedGitHubAppConfig();
  }

  const result = await db
    .select()
    .from(githubAppConfigurations)
    .where(eq(githubAppConfigurations.organizationId, organizationId))
    .limit(1);

  if (result.length === 0) return null;

  const config = result[0];
  const privateKey = decrypt(config.encryptedPrivateKey, config.privateKeyIv);

  return {
    appId: config.appId,
    appSlug: config.appSlug,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

export async function saveGitHubAppConfig(
  organizationId: string,
  appId: string,
  appSlug: string,
  privateKey: string
): Promise<void> {
  const { ciphertext, iv } = encrypt(privateKey);

  const existing = await db
    .select()
    .from(githubAppConfigurations)
    .where(eq(githubAppConfigurations.organizationId, organizationId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(githubAppConfigurations)
      .set({
        appId,
        appSlug,
        encryptedPrivateKey: ciphertext,
        privateKeyIv: iv,
        updatedAt: new Date(),
      })
      .where(eq(githubAppConfigurations.organizationId, organizationId));
  } else {
    await db.insert(githubAppConfigurations).values({
      id: crypto.randomUUID(),
      organizationId,
      appId,
      appSlug,
      encryptedPrivateKey: ciphertext,
      privateKeyIv: iv,
    });
  }
}

export function validateGitHubAppConfig(
  appId: string,
  privateKey: string
): { valid: boolean; error?: string } {
  try {
    const normalizedKey = privateKey.replace(/\\n/g, "\n");
    const now = Math.floor(Date.now() / 1000);
    const payload = { iat: now - 60, exp: now + 600, iss: appId };
    const header = { alg: "RS256", typ: "JWT" };
    const encodedHeader = base64url(Buffer.from(JSON.stringify(header)));
    const encodedPayload = base64url(Buffer.from(JSON.stringify(payload)));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(signatureInput);
    sign.sign(normalizedKey);
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid private key format" };
  }
}

function base64url(input: Buffer | string): string {
  const str = typeof input === "string" ? input : input.toString("base64");
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function generateAppJWT(organizationId: string): Promise<string> {
  const config = await getGitHubAppConfig(organizationId);
  if (!config) {
    throw new Error("GitHub App not configured for this organization");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: config.appId,
  };

  const header = { alg: "RS256", typ: "JWT" };
  const encodedHeader = base64url(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64url(Buffer.from(JSON.stringify(payload)));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signatureInput);
  const signature = sign.sign(config.privateKey);

  return `${signatureInput}.${base64url(signature)}`;
}

export async function listAppInstallations(
  organizationId: string
): Promise<GitHubAppInstallation[]> {
  const jwt = await generateAppJWT(organizationId);

  const response = await fetch(`${GITHUB_API_BASE}/app/installations`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list app installations: ${error}`);
  }

  const data = await response.json();
  return data.map((inst: Record<string, unknown>) => ({
    id: inst.id as number,
    account: {
      login: (inst.account as Record<string, unknown>).login as string,
      id: (inst.account as Record<string, unknown>).id as number,
      type: (inst.account as Record<string, unknown>).type as string,
    },
    repositorySelection: inst.repository_selection as "all" | "selected",
  }));
}

export async function getInstallationAccessToken(
  organizationId: string,
  installationId: string
): Promise<{ token: string; expiresAt: Date }> {
  const jwt = await generateAppJWT(organizationId);

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

export type InstallationResult =
  | { status: "active"; installationId: string; accessToken: string; expiresAt: Date }
  | { status: "pending" }
  | null;

export async function getInstallation(organizationId: string): Promise<InstallationResult> {
  const result = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.organizationId, organizationId))
    .limit(1);

  if (result.length === 0) return null;

  const installation = result[0];

  if (!installation.installationId || !installation.encryptedAccessToken || !installation.accessTokenIv) {
    return { status: "pending" };
  }

  const accessToken = decrypt(installation.encryptedAccessToken, installation.accessTokenIv);

  return {
    status: "active",
    installationId: installation.installationId,
    accessToken,
    expiresAt: installation.accessTokenExpiresAt!,
  };
}

export async function getOrRefreshAccessToken(organizationId: string): Promise<string | null> {
  const installation = await getInstallation(organizationId);
  if (!installation || installation.status === "pending") return null;

  const bufferTime = 5 * 60 * 1000;
  if (installation.expiresAt.getTime() - Date.now() > bufferTime) {
    return installation.accessToken;
  }

  const { token, expiresAt } = await getInstallationAccessToken(
    organizationId,
    installation.installationId
  );
  await saveInstallation(organizationId, installation.installationId, token, expiresAt);
  return token;
}

export async function getGitHubAppInstallUrl(organizationId: string): Promise<string> {
  const config = await getGitHubAppConfig(organizationId);
  if (!config) {
    throw new Error("GitHub App not configured for this organization");
  }
  return `https://github.com/apps/${config.appSlug}/installations/new`;
}

export async function getGitHubAppConfigureUrl(organizationId: string): Promise<string> {
  const config = await getGitHubAppConfig(organizationId);
  if (!config) {
    throw new Error("GitHub App not configured for this organization");
  }
  return `https://github.com/apps/${config.appSlug}/installations/new`;
}

export async function exchangeCodeForUserToken(code: string, organizationId: string): Promise<string> {
  const config = await getGitHubAppConfig(organizationId);
  if (!config) throw new Error("GitHub App not configured");

  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GitHub OAuth credentials not configured");

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(`OAuth error: ${data.error_description || data.error}`);
  return data.access_token;
}

export async function getGitHubUser(token: string): Promise<{ login: string; id: number }> {
  const response = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) throw new Error("Failed to fetch GitHub user");
  const data = await response.json();
  return { login: data.login, id: data.id };
}

export async function findInstallationRequestAccount(
  organizationId: string,
  requesterLogin: string
): Promise<string | null> {
  const jwt = await generateAppJWT(organizationId);

  const response = await fetch(`${GITHUB_API_BASE}/app/installation-requests`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) return null;

  const requests = await response.json();
  const match = requests.find(
    (r: { requester: { login: string } }) => r.requester.login === requesterLogin
  );

  return match?.account?.login || null;
}

export async function savePendingInstallation(
  organizationId: string,
  githubAccountLogin: string
): Promise<void> {
  const existing = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.organizationId, organizationId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(githubInstallations)
      .set({ githubAccountLogin, updatedAt: new Date() })
      .where(eq(githubInstallations.organizationId, organizationId));
  } else {
    await db.insert(githubInstallations).values({
      id: crypto.randomUUID(),
      organizationId,
      githubAccountLogin,
    });
  }
}

export async function completePendingInstallation(
  githubAccountLogin: string,
  installationId: string
): Promise<boolean> {
  const pending = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.githubAccountLogin, githubAccountLogin))
    .limit(1);

  if (pending.length === 0 || pending[0].installationId) return false;

  const organizationId = pending[0].organizationId;
  const { token, expiresAt } = await getInstallationAccessToken(organizationId, installationId);
  await saveInstallation(organizationId, installationId, token, expiresAt);

  await db
    .update(githubInstallations)
    .set({ githubAccountLogin })
    .where(eq(githubInstallations.organizationId, organizationId));

  return true;
}

export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}
