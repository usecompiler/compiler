import { Resend } from "resend";
import { isSaas } from "./appMode.server";

interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

let cachedClient: Resend | null = null;

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!cachedClient) {
    cachedClient = new Resend(key);
  }
  return cachedClient;
}

export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<void> {
  if (!isSaas()) return;

  const from = process.env.EMAIL_FROM;
  const client = getClient();
  if (!client || !from) {
    console.warn("[email] RESEND_API_KEY or EMAIL_FROM not configured — skipping send");
    return;
  }

  const result = await client.emails.send({ from, to, subject, html, text });
  if (result.error) {
    console.error(`[email] Send failed:`, result.error);
    return;
  }
  console.log(`[email] Sent "${subject}" to ${Array.isArray(to) ? to.join(", ") : to} (id=${result.data?.id})`);
}
