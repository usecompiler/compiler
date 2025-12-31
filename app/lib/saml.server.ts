import { SAML } from "@node-saml/node-saml";
import { db } from "~/lib/db/index.server";
import { ssoConfigurations } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

export interface SSOConfig {
  id: string;
  organizationId: string;
  enabled: boolean;
  providerName: string | null;
  idpEntityId: string | null;
  idpSsoUrl: string | null;
  idpCertificate: string | null;
  spEntityId: string | null;
  spAcsUrl: string | null;
  allowPasswordLogin: boolean;
  autoProvisionUsers: boolean;
}

export async function getSSOConfig(organizationId: string): Promise<SSOConfig | null> {
  const [config] = await db
    .select()
    .from(ssoConfigurations)
    .where(eq(ssoConfigurations.organizationId, organizationId))
    .limit(1);

  return config || null;
}

export async function getDefaultOrgSSOConfig(): Promise<SSOConfig | null> {
  const [config] = await db
    .select()
    .from(ssoConfigurations)
    .limit(1);

  return config || null;
}

export async function saveSSOConfig(
  organizationId: string,
  config: {
    enabled: boolean;
    providerName: string;
    idpEntityId: string;
    idpSsoUrl: string;
    idpCertificate: string;
    allowPasswordLogin: boolean;
  },
  baseUrl: string
): Promise<SSOConfig> {
  const spEntityId = `${baseUrl}/auth/saml/metadata`;
  const spAcsUrl = `${baseUrl}/auth/saml/callback`;

  const existing = await getSSOConfig(organizationId);

  if (existing) {
    const [updated] = await db
      .update(ssoConfigurations)
      .set({
        enabled: config.enabled,
        providerName: config.providerName,
        idpEntityId: config.idpEntityId,
        idpSsoUrl: config.idpSsoUrl,
        idpCertificate: config.idpCertificate,
        spEntityId,
        spAcsUrl,
        allowPasswordLogin: config.allowPasswordLogin,
        updatedAt: new Date(),
      })
      .where(eq(ssoConfigurations.organizationId, organizationId))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(ssoConfigurations)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      enabled: config.enabled,
      providerName: config.providerName,
      idpEntityId: config.idpEntityId,
      idpSsoUrl: config.idpSsoUrl,
      idpCertificate: config.idpCertificate,
      spEntityId,
      spAcsUrl,
      allowPasswordLogin: config.allowPasswordLogin,
    })
    .returning();

  return created;
}

export function createSAMLClient(config: SSOConfig, baseUrl: string): SAML {
  if (!config.idpEntityId || !config.idpSsoUrl || !config.idpCertificate) {
    throw new Error("Incomplete SAML configuration");
  }

  return new SAML({
    issuer: config.spEntityId || `${baseUrl}/auth/saml/metadata`,
    callbackUrl: config.spAcsUrl || `${baseUrl}/auth/saml/callback`,
    entryPoint: config.idpSsoUrl,
    idpIssuer: config.idpEntityId,
    idpCert: config.idpCertificate,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
  });
}

export async function generateAuthUrl(
  config: SSOConfig,
  baseUrl: string,
  relayState?: string
): Promise<string> {
  const saml = createSAMLClient(config, baseUrl);
  const host = new URL(baseUrl).host;
  const url = await saml.getAuthorizeUrlAsync(relayState || "/", host, {});
  return url;
}

export interface SAMLUserInfo {
  email: string;
  name: string;
  nameId: string;
}

export async function validateSAMLResponse(
  config: SSOConfig,
  baseUrl: string,
  samlResponse: string
): Promise<SAMLUserInfo> {
  const saml = createSAMLClient(config, baseUrl);

  const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });

  if (!profile) {
    throw new Error("No profile returned from SAML response");
  }

  const emailValue =
    profile.email ||
    profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] ||
    profile.nameID;

  const email = typeof emailValue === "string" ? emailValue : null;

  if (!email) {
    throw new Error("No email found in SAML assertion");
  }

  const nameValue =
    profile.displayName ||
    profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] ||
    profile.firstName ||
    email.split("@")[0];

  const name = typeof nameValue === "string" ? nameValue : "User";

  return {
    email: email.toLowerCase(),
    name,
    nameId: profile.nameID || email,
  };
}

export function generateSPMetadata(config: SSOConfig, baseUrl: string): string {
  const entityId = config.spEntityId || `${baseUrl}/auth/saml/metadata`;
  const acsUrl = config.spAcsUrl || `${baseUrl}/auth/saml/callback`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="0" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
}
