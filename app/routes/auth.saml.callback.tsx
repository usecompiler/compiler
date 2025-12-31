import { redirect } from "react-router";
import type { Route } from "./+types/auth.saml.callback";
import { getDefaultOrgSSOConfig, validateSAMLResponse } from "~/lib/saml.server";
import { db } from "~/lib/db/index.server";
import { users, members, organizations } from "~/lib/db/schema";
import { eq } from "drizzle-orm";
import { createSession, createSessionCookie } from "~/lib/auth.server";

export async function action({ request }: Route.ActionArgs) {
  const config = await getDefaultOrgSSOConfig();

  if (!config || !config.enabled) {
    throw redirect("/login?error=sso_not_configured");
  }

  const formData = await request.formData();
  const samlResponse = formData.get("SAMLResponse") as string;
  const relayState = formData.get("RelayState") as string || "/";

  if (!samlResponse) {
    throw redirect("/login?error=missing_saml_response");
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  try {
    const userInfo = await validateSAMLResponse(config, baseUrl, samlResponse);

    let [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, userInfo.email))
      .limit(1);

    if (!existingUser) {
      if (!config.autoProvisionUsers) {
        throw redirect("/login?error=user_not_provisioned");
      }

      const userId = crypto.randomUUID();
      [existingUser] = await db
        .insert(users)
        .values({
          id: userId,
          email: userInfo.email,
          name: userInfo.name,
          passwordHash: null,
        })
        .returning();

      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, config.organizationId))
        .limit(1);

      if (org) {
        await db.insert(members).values({
          id: crypto.randomUUID(),
          userId: existingUser.id,
          organizationId: org.id,
          role: "member",
        });
      }
    } else {
      const [existingMembership] = await db
        .select()
        .from(members)
        .where(eq(members.userId, existingUser.id))
        .limit(1);

      if (!existingMembership) {
        const [org] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, config.organizationId))
          .limit(1);

        if (org) {
          await db.insert(members).values({
            id: crypto.randomUUID(),
            userId: existingUser.id,
            organizationId: org.id,
            role: "member",
          });
        }
      }
    }

    const sessionId = await createSession(existingUser.id);

    return redirect(relayState, {
      headers: {
        "Set-Cookie": createSessionCookie(sessionId),
      },
    });
  } catch (e) {
    if (e instanceof Response) {
      throw e;
    }
    console.error("SAML validation error:", e);
    throw redirect("/login?error=saml_validation_failed");
  }
}

export async function loader() {
  throw redirect("/login");
}

export default function SAMLCallback() {
  return null;
}
