import { sendEmail } from "./email.server";

const NOTIFY_RECIPIENT = "pete@usecompiler.com";

export async function sendNewSignupNotificationEmail(params: {
  name: string;
  email: string;
}): Promise<void> {
  const { name, email } = params;
  const text = `A new signup for Compiler.

Name: ${name}
Email: ${email}`;

  await sendEmail({
    to: NOTIFY_RECIPIENT,
    subject: `New Compiler signup: ${name}`,
    text,
    html: text.replace(/\n/g, "<br>"),
  });
}
