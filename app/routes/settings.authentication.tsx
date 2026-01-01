import { useState, useEffect } from "react";
import { Form, Link, redirect, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/settings.authentication";
import { requireActiveAuth } from "~/lib/auth.server";
import { canManageOrganization } from "~/lib/permissions";
import { getSSOConfig, saveSSOConfig, generateSPMetadata } from "~/lib/saml.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!canManageOrganization(user.membership?.role)) {
    throw redirect("/settings");
  }

  if (!user.organization) {
    return { config: null, baseUrl: "", spMetadata: null };
  }

  const config = await getSSOConfig(user.organization.id);
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const defaultConfig = {
    id: "",
    organizationId: user.organization.id,
    enabled: false,
    providerName: null,
    idpEntityId: null,
    idpSsoUrl: null,
    idpCertificate: null,
    spEntityId: `${baseUrl}/auth/saml/metadata`,
    spAcsUrl: `${baseUrl}/auth/saml/callback`,
    allowPasswordLogin: true,
    autoProvisionUsers: true,
  };

  const spMetadata = generateSPMetadata(config || defaultConfig, baseUrl);

  return { config, baseUrl, spMetadata };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization || !user.membership) {
    return { error: "No organization found", success: false };
  }

  if (!canManageOrganization(user.membership.role)) {
    return { error: "Only owners and admins can manage authentication settings", success: false };
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save") {
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    const enabled = formData.get("enabled") === "true";
    const allowPasswordLogin = formData.get("allowPasswordLogin") === "true";

    if (!enabled && !allowPasswordLogin) {
      return { error: "At least one authentication method must be enabled", success: false };
    }

    try {
      await saveSSOConfig(
        user.organization.id,
        {
          enabled,
          providerName: formData.get("providerName") as string || "",
          idpEntityId: formData.get("idpEntityId") as string || "",
          idpSsoUrl: formData.get("idpSsoUrl") as string || "",
          idpCertificate: formData.get("idpCertificate") as string || "",
          allowPasswordLogin,
        },
        baseUrl
      );
      return { error: null, success: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Failed to save configuration", success: false };
    }
  }

  return { error: "Unknown action", success: false };
}

export default function AuthenticationSettings() {
  const { config, baseUrl, spMetadata } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [allowPasswordLogin, setAllowPasswordLogin] = useState(config?.allowPasswordLogin ?? true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (actionData) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [actionData]);

  const handleSSOToggle = () => {
    if (enabled && !allowPasswordLogin) return;
    setEnabled(!enabled);
  };

  const handlePasswordToggle = () => {
    if (allowPasswordLogin && !enabled) return;
    setAllowPasswordLogin(!allowPasswordLogin);
  };

  const spEntityId = `${baseUrl}/auth/saml/metadata`;
  const spAcsUrl = `${baseUrl}/auth/saml/callback`;

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const downloadMetadata = () => {
    if (!spMetadata) return;
    const blob = new Blob([spMetadata], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sp-metadata.xml";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/"
            className="p-2 -ml-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <h1 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Settings</h1>
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
            <Link
              to="/settings/ai-provider"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              AI Provider
            </Link>
            <span className="py-3 text-sm text-neutral-900 dark:text-neutral-100 font-medium border-b-2 border-neutral-900 dark:border-neutral-100">
              Authentication
            </span>
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

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {actionData?.error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
            {actionData.error}
          </div>
        )}

        {actionData?.success && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 text-sm text-green-400">
            Configuration saved successfully
          </div>
        )}

        <Form method="post" className="space-y-8">
          <input type="hidden" name="intent" value="save" />

          <section>
            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg divide-y divide-neutral-200 dark:divide-neutral-700">
              <div className="px-4 py-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    Enable SSO
                  </div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                    Allow users to sign in using your identity provider
                  </div>
                </div>
                <input type="hidden" name="enabled" value={enabled ? "true" : "false"} />
                <button
                  type="button"
                  onClick={handleSSOToggle}
                  disabled={enabled && !allowPasswordLogin}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    enabled ? "bg-blue-500" : "bg-neutral-300 dark:bg-neutral-600"
                  } ${enabled && !allowPasswordLogin ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      enabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="px-4 py-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    Allow Password Login
                  </div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                    Allow users to sign in with email and password
                  </div>
                </div>
                <input type="hidden" name="allowPasswordLogin" value={allowPasswordLogin ? "true" : "false"} />
                <button
                  type="button"
                  onClick={handlePasswordToggle}
                  disabled={allowPasswordLogin && !enabled}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    allowPasswordLogin ? "bg-blue-500" : "bg-neutral-300 dark:bg-neutral-600"
                  } ${allowPasswordLogin && !enabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      allowPasswordLogin ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
              Identity Provider Configuration
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
              Get these values from your identity provider&apos;s admin console (Okta, Azure AD, Google Workspace, etc.)
            </p>

            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4 space-y-4">
              <div>
                <label htmlFor="providerName" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Provider Name
                </label>
                <input
                  type="text"
                  id="providerName"
                  name="providerName"
                  defaultValue={config?.providerName || ""}
                  placeholder="Okta, Azure AD, Google Workspace..."
                  className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="idpEntityId" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  IdP Entity ID / Issuer
                </label>
                <input
                  type="text"
                  id="idpEntityId"
                  name="idpEntityId"
                  defaultValue={config?.idpEntityId || ""}
                  placeholder="https://your-idp.com/entity-id"
                  className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="idpSsoUrl" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  IdP SSO URL
                </label>
                <input
                  type="text"
                  id="idpSsoUrl"
                  name="idpSsoUrl"
                  defaultValue={config?.idpSsoUrl || ""}
                  placeholder="https://your-idp.com/saml/sso"
                  className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="idpCertificate" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  IdP Certificate (X.509, PEM format)
                </label>
                <textarea
                  id="idpCertificate"
                  name="idpCertificate"
                  defaultValue={config?.idpCertificate || ""}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                  rows={6}
                  className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
              Service Provider Details
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
              Copy these values to your identity provider when configuring the SAML application
            </p>

            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  SP Entity ID / Audience
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={spEntityId}
                    className="flex-1 px-3 py-2 bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm text-neutral-600 dark:text-neutral-400"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(spEntityId, "entityId")}
                    className="px-3 py-2 bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-lg text-sm hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
                  >
                    {copied === "entityId" ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Assertion Consumer Service (ACS) URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={spAcsUrl}
                    className="flex-1 px-3 py-2 bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm text-neutral-600 dark:text-neutral-400"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(spAcsUrl, "acsUrl")}
                    className="px-3 py-2 bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-lg text-sm hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
                  >
                    {copied === "acsUrl" ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              {spMetadata && (
                <button
                  type="button"
                  onClick={downloadMetadata}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download SP Metadata XML
                </button>
              )}
            </div>
          </section>

          <div className="pt-2">
            <button
              type="submit"
              className="px-4 py-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
            >
              Save Changes
            </button>
          </div>
        </Form>
      </main>
    </div>
  );
}
