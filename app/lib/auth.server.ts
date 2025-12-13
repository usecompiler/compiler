import { redirect } from "react-router";
import { db } from "./db/index.server";
import { users, sessions } from "./db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const SESSION_COOKIE = "session";
const SESSION_EXPIRY_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  return sessionId;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

function getSessionIdFromCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split("; ").map((c) => {
      const [key, ...rest] = c.split("=");
      return [key, rest.join("=")];
    })
  );

  return cookies[SESSION_COOKIE] || null;
}

export function createSessionCookie(sessionId: string): string {
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_EXPIRY_DAYS);
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}`;
}

export function createLogoutCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export async function getUser(request: Request): Promise<User | null> {
  const sessionId = getSessionIdFromCookie(request);
  if (!sessionId) return null;

  const result = await db
    .select({
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      userEmail: users.email,
      userName: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (result.length === 0) return null;

  const session = result[0];
  if (new Date() > session.expiresAt) {
    await deleteSession(sessionId);
    return null;
  }

  return {
    id: session.userId,
    email: session.userEmail,
    name: session.userName,
  };
}

export async function requireAuth(request: Request): Promise<User> {
  const user = await getUser(request);
  if (!user) {
    throw redirect("/login");
  }
  return user;
}

export async function getUserByEmail(email: string) {
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  return result[0] || null;
}

export async function createUser(
  email: string,
  name: string,
  password: string
): Promise<User> {
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  await db.insert(users).values({
    id,
    email: email.toLowerCase(),
    name,
    passwordHash,
  });

  return { id, email: email.toLowerCase(), name };
}
