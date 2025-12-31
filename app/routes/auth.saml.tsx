import { redirect } from "react-router";
import type { Route } from "./+types/auth.saml";
import { getDefaultOrgSSOConfig, generateAuthUrl } from "~/lib/saml.server";

export async function loader({ request }: Route.LoaderArgs) {
  const config = await getDefaultOrgSSOConfig();

  if (!config || !config.enabled) {
    throw redirect("/login?error=sso_not_configured");
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const relayState = url.searchParams.get("redirect") || "/";

  try {
    const authUrl = await generateAuthUrl(config, baseUrl, relayState);
    throw redirect(authUrl);
  } catch (e) {
    if (e instanceof Response) {
      throw e;
    }
    console.error("SAML auth error:", e);
    throw redirect("/login?error=sso_error");
  }
}

export default function SAMLLogin() {
  return null;
}
