import { redirect } from "react-router";
import { db } from "./db/index.server";
import { users, sessions, organizations, members } from "./db/schema";
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

export interface Organization {
  id: string;
  onboardingCompleted: boolean;
  createdAt: Date;
}

export interface Membership {
  id: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
  isDeactivated: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  organization: Organization | null;
  membership: Membership | null;
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
      orgId: organizations.id,
      orgOnboardingCompleted: organizations.onboardingCompleted,
      orgCreatedAt: organizations.createdAt,
      memberId: members.id,
      memberRole: members.role,
      memberDeactivatedAt: members.deactivatedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(members, eq(users.id, members.userId))
    .leftJoin(organizations, eq(members.organizationId, organizations.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (result.length === 0) return null;

  const session = result[0];
  if (new Date() > session.expiresAt) {
    await deleteSession(sessionId);
    return null;
  }

  const isDeactivated = session.memberDeactivatedAt !== null;

  return {
    id: session.userId,
    email: session.userEmail,
    name: session.userName,
    organization: session.orgId
      ? { id: session.orgId, onboardingCompleted: session.orgOnboardingCompleted ?? false, createdAt: session.orgCreatedAt! }
      : null,
    membership: session.orgId && session.memberId
      ? {
          id: session.memberId,
          organizationId: session.orgId,
          role: session.memberRole as "owner" | "admin" | "member",
          isDeactivated,
        }
      : null,
  };
}

export async function requireAuth(request: Request): Promise<User> {
  const user = await getUser(request);
  if (!user) {
    throw redirect("/login");
  }
  return user;
}

// Require auth AND check that user is not deactivated
export async function requireActiveAuth(request: Request): Promise<User> {
  const user = await getUser(request);
  if (!user) {
    throw redirect("/login");
  }
  if (user.membership?.isDeactivated) {
    throw redirect("/deactivated");
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

export async function createOrganization(ownerId: string): Promise<{ organization: Organization; memberId: string }> {
  const orgId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const createdAt = new Date();

  await db.insert(organizations).values({
    id: orgId,
  });

  await db.insert(members).values({
    id: memberId,
    userId: ownerId,
    organizationId: orgId,
    role: "owner",
  });

  return { organization: { id: orgId, onboardingCompleted: false, createdAt }, memberId };
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

  const { organization, memberId } = await createOrganization(id);

  return {
    id,
    email: email.toLowerCase(),
    name,
    organization,
    membership: {
      id: memberId,
      organizationId: organization.id,
      role: "owner",
      isDeactivated: false,
    },
  };
}

// Create user without automatically creating an organization
// Used when user signs up via invitation link
export async function createUserWithoutOrg(
  email: string,
  name: string,
  password: string
): Promise<{ id: string; email: string; name: string }> {
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  await db.insert(users).values({
    id,
    email: email.toLowerCase(),
    name,
    passwordHash,
  });

  return {
    id,
    email: email.toLowerCase(),
    name,
  };
}

export async function updateUserName(userId: string, name: string): Promise<void> {
  await db.update(users).set({ name }).where(eq(users.id, userId));
}

export async function updateUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const result = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (result.length === 0) return false;

  const { passwordHash } = result[0];
  if (!passwordHash) return false;

  const valid = await verifyPassword(currentPassword, passwordHash);
  if (!valid) return false;

  const newHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId));

  return true;
}
