import type { Route } from "./+types/auth.saml.metadata";
import { getDefaultOrgSSOConfig, generateSPMetadata } from "~/lib/saml.server";
import { getPublicBaseUrl } from "~/lib/url.server";

export async function loader({ request }: Route.LoaderArgs) {
  const config = await getDefaultOrgSSOConfig();
  const baseUrl = getPublicBaseUrl(request);

  const defaultConfig = {
    id: "",
    organizationId: "",
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

  const metadata = generateSPMetadata(config || defaultConfig, baseUrl);

  return new Response(metadata, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
}

export default function SAMLMetadata() {
  return null;
}
