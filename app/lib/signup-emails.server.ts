import { sendEmail } from "./email.server";

const NOTIFY_RECIPIENTS = ["pete@usecompiler.com", "ryan@usecompiler.com"];

export function fireAndForget(promise: Promise<void>): void {
  promise.catch((err) => console.error("[email] Notification failed:", err));
}

export async function sendNewSignupNotificationEmail(params: {
  name: string;
  email: string;
}): Promise<void> {
  const { name, email } = params;
  const text = `A new signup for Compiler.

Name: ${name}
Email: ${email}`;

  await sendEmail({
    to: NOTIFY_RECIPIENTS,
    subject: `New Compiler signup: ${name}`,
    text,
    html: text.replace(/\n/g, "<br>"),
  });
}

export async function sendNewProjectNotificationEmail(params: {
  userName: string;
  userEmail: string;
  projectName: string;
}): Promise<void> {
  const { userName, userEmail, projectName } = params;
  const text = `A new project was created on Compiler.

Project: ${projectName}
Created by: ${userName} (${userEmail})`;

  await sendEmail({
    to: NOTIFY_RECIPIENTS,
    subject: `New Compiler project: ${projectName}`,
    text,
    html: text.replace(/\n/g, "<br>"),
  });
}

export async function sendNewConversationNotificationEmail(params: {
  userName: string;
  userEmail: string;
}): Promise<void> {
  const { userName, userEmail } = params;
  const text = `A new conversation was started on Compiler.

Started by: ${userName} (${userEmail})`;

  await sendEmail({
    to: NOTIFY_RECIPIENTS,
    subject: `New Compiler conversation from ${userName}`,
    text,
    html: text.replace(/\n/g, "<br>"),
  });
}
