import { and, eq } from "drizzle-orm";
import { db } from "./db/index.server";
import { members, users } from "./db/schema";
import { sendEmail } from "./email.server";

interface SendInstallationApprovedEmailParams {
  organizationId: string;
  githubAccountLogin: string;
  baseUrl: string;
}

export async function sendInstallationApprovedEmail({
  organizationId,
  githubAccountLogin,
  baseUrl,
}: SendInstallationApprovedEmailParams): Promise<void> {
  const owners = await db
    .select({ email: users.email, name: users.name })
    .from(members)
    .innerJoin(users, eq(members.userId, users.id))
    .where(and(eq(members.organizationId, organizationId), eq(members.role, "owner")));

  if (owners.length === 0) {
    console.warn(`[email] No owners found for organization ${organizationId}, skipping install-approved email`);
    return;
  }

  const link = `${baseUrl.replace(/\/$/, "")}/onboarding/github`;
  const subject = `Your GitHub access on ${githubAccountLogin} was approved`;

  for (const owner of owners) {
    const greeting = owner.name ? `Hi ${owner.name},` : "Hi,";
    const html = `<p>${greeting}</p>
<p>Your admin approved Compiler's GitHub App installation on <strong>${githubAccountLogin}</strong>.</p>
<p>You can pick up where you left off: <a href="${link}">${link}</a></p>
<p>— The Compiler team</p>`;
    const text = `${greeting}

Your admin approved Compiler's GitHub App installation on ${githubAccountLogin}.

You can pick up where you left off: ${link}

— The Compiler team`;

    await sendEmail({ to: owner.email, subject, html, text });
  }
}
