import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSAMLClient, generateSPMetadata } from "./saml.server";
import type { SSOConfig } from "./saml.server";

let capturedSAMLOptions: Record<string, unknown> | null = null;

vi.mock("@node-saml/node-saml", () => ({
  SAML: class MockSAML {
    constructor(opts: Record<string, unknown>) {
      capturedSAMLOptions = opts;
    }
  },
}));

vi.mock("~/lib/db/index.server", () => ({ db: {} }));
vi.mock("~/lib/db/schema", () => ({ ssoConfigurations: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

function buildConfig(overrides: Partial<SSOConfig> = {}): SSOConfig {
  return {
    id: "sso-1",
    organizationId: "org-1",
    enabled: true,
    providerName: "Azure AD",
    idpEntityId: "https://idp.example.com/entity",
    idpSsoUrl: "https://idp.example.com/sso",
    idpCertificate: "MIIC...",
    spEntityId: "https://app.example.com/auth/saml/metadata",
    spAcsUrl: "https://app.example.com/auth/saml/callback",
    allowPasswordLogin: true,
    autoProvisionUsers: false,
    ...overrides,
  };
}

const BASE_URL = "https://app.example.com";

beforeEach(() => {
  capturedSAMLOptions = null;
});

describe("createSAMLClient", () => {
  it("passes disableRequestedAuthnContext: true", () => {
    const config = buildConfig();
    createSAMLClient(config, BASE_URL);
    expect(capturedSAMLOptions).toHaveProperty("disableRequestedAuthnContext", true);
  });

  it("throws on incomplete config (missing idpEntityId)", () => {
    const config = buildConfig({ idpEntityId: null });
    expect(() => createSAMLClient(config, BASE_URL)).toThrow(
      "Incomplete SAML configuration"
    );
  });

  it("throws on incomplete config (missing idpSsoUrl)", () => {
    const config = buildConfig({ idpSsoUrl: null });
    expect(() => createSAMLClient(config, BASE_URL)).toThrow(
      "Incomplete SAML configuration"
    );
  });

  it("throws on incomplete config (missing idpCertificate)", () => {
    const config = buildConfig({ idpCertificate: null });
    expect(() => createSAMLClient(config, BASE_URL)).toThrow(
      "Incomplete SAML configuration"
    );
  });

  it("uses config values for issuer, callbackUrl, entryPoint, idpIssuer, idpCert", () => {
    const config = buildConfig();
    createSAMLClient(config, BASE_URL);
    expect(capturedSAMLOptions).toMatchObject({
      issuer: "https://app.example.com/auth/saml/metadata",
      callbackUrl: "https://app.example.com/auth/saml/callback",
      entryPoint: "https://idp.example.com/sso",
      idpIssuer: "https://idp.example.com/entity",
      idpCert: "MIIC...",
    });
  });

  it("falls back to baseUrl-derived issuer when spEntityId is null", () => {
    const config = buildConfig({ spEntityId: null });
    createSAMLClient(config, BASE_URL);
    expect(capturedSAMLOptions).toHaveProperty(
      "issuer",
      "https://app.example.com/auth/saml/metadata"
    );
  });

  it("falls back to baseUrl-derived callbackUrl when spAcsUrl is null", () => {
    const config = buildConfig({ spAcsUrl: null });
    createSAMLClient(config, BASE_URL);
    expect(capturedSAMLOptions).toHaveProperty(
      "callbackUrl",
      "https://app.example.com/auth/saml/callback"
    );
  });
});

describe("generateSPMetadata", () => {
  it("generates valid XML with correct entityID and ACS URL", () => {
    const config = buildConfig();
    const xml = generateSPMetadata(config, BASE_URL);
    expect(xml).toContain('entityID="https://app.example.com/auth/saml/metadata"');
    expect(xml).toContain('Location="https://app.example.com/auth/saml/callback"');
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("urn:oasis:names:tc:SAML:2.0:metadata");
  });

  it("falls back to baseUrl-derived values when config fields are null", () => {
    const config = buildConfig({ spEntityId: null, spAcsUrl: null });
    const xml = generateSPMetadata(config, BASE_URL);
    expect(xml).toContain('entityID="https://app.example.com/auth/saml/metadata"');
    expect(xml).toContain('Location="https://app.example.com/auth/saml/callback"');
  });
});
