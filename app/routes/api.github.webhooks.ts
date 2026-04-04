import type { Route } from "./+types/api.github.webhooks";
import {
  verifyWebhookSignature,
  completePendingInstallation,
} from "~/lib/github.server";
import { db } from "~/lib/db/index.server";
import { githubInstallations } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const signature = request.headers.get("X-Hub-Signature-256");
  if (!signature) {
    return new Response("Missing signature", { status: 401 });
  }

  const body = await request.text();

  if (!verifyWebhookSignature(body, signature, secret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = request.headers.get("X-GitHub-Event");
  const payload = JSON.parse(body);

  if (event === "installation") {
    if (payload.action === "created") {
      const installationId = String(payload.installation.id);
      const accountLogin = payload.installation.account?.login;

      if (accountLogin) {
        const linked = await completePendingInstallation(accountLogin, installationId);
        if (linked) {
          console.log(`[webhook] Linked installation ${installationId} for ${accountLogin}`);
        }
      }
    }

    if (payload.action === "deleted") {
      const installationId = String(payload.installation.id);
      await db
        .delete(githubInstallations)
        .where(eq(githubInstallations.installationId, installationId));
      console.log(`[webhook] Deleted installation ${installationId}`);
    }
  }

  return new Response("OK", { status: 200 });
}
