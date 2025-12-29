import { db } from "./db/index.server";
import { invitations, members, users, organizations } from "./db/schema";
import { eq, and, gt } from "drizzle-orm";

const INVITATION_EXPIRY_HOURS = 24;

export interface Invitation {
  id: string;
  organizationId: string;
  token: string;
  role: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface Member {
  id: string;
  userId: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
  isDeactivated: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

function generateToken(): string {
  // Generate a secure random token
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createInvitation(
  organizationId: string,
  role: "owner" | "admin" | "member" = "member"
): Promise<Invitation> {
  const id = crypto.randomUUID();
  const token = generateToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + INVITATION_EXPIRY_HOURS);

  await db.insert(invitations).values({
    id,
    organizationId,
    token,
    role,
    expiresAt,
  });

  return {
    id,
    organizationId,
    token,
    role,
    expiresAt,
    createdAt: new Date(),
  };
}

export async function getInvitationByToken(token: string): Promise<Invitation | null> {
  const result = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.token, token), gt(invitations.expiresAt, new Date())))
    .limit(1);

  if (result.length === 0) return null;

  const inv = result[0];
  return {
    id: inv.id,
    organizationId: inv.organizationId,
    token: inv.token,
    role: inv.role,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
  };
}

export async function acceptInvitation(token: string, userId: string): Promise<boolean> {
  const invitation = await getInvitationByToken(token);
  if (!invitation) return false;

  // Check if user is already a member of this org
  const existingMember = await db
    .select()
    .from(members)
    .where(
      and(eq(members.userId, userId), eq(members.organizationId, invitation.organizationId))
    )
    .limit(1);

  if (existingMember.length > 0) {
    // Already a member, just delete the invitation
    await db.delete(invitations).where(eq(invitations.id, invitation.id));
    return true;
  }

  // Add user as member
  await db.insert(members).values({
    id: crypto.randomUUID(),
    userId,
    organizationId: invitation.organizationId,
    role: invitation.role,
  });

  // Delete the invitation (single-use)
  await db.delete(invitations).where(eq(invitations.id, invitation.id));

  return true;
}

export async function revokeInvitation(id: string, organizationId: string): Promise<void> {
  await db
    .delete(invitations)
    .where(and(eq(invitations.id, id), eq(invitations.organizationId, organizationId)));
}

export async function getInvitations(organizationId: string): Promise<Invitation[]> {
  const result = await db
    .select()
    .from(invitations)
    .where(
      and(eq(invitations.organizationId, organizationId), gt(invitations.expiresAt, new Date()))
    )
    .orderBy(invitations.createdAt);

  return result.map((inv) => ({
    id: inv.id,
    organizationId: inv.organizationId,
    token: inv.token,
    role: inv.role,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
  }));
}

export async function getMembers(organizationId: string): Promise<Member[]> {
  const result = await db
    .select({
      id: members.id,
      userId: members.userId,
      organizationId: members.organizationId,
      role: members.role,
      deactivatedAt: members.deactivatedAt,
      createdAt: members.createdAt,
      userEmail: users.email,
      userName: users.name,
    })
    .from(members)
    .innerJoin(users, eq(members.userId, users.id))
    .where(eq(members.organizationId, organizationId))
    .orderBy(members.createdAt);

  return result.map((row) => ({
    id: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    role: row.role as "owner" | "admin" | "member",
    isDeactivated: row.deactivatedAt !== null,
    deactivatedAt: row.deactivatedAt,
    createdAt: row.createdAt,
    user: {
      id: row.userId,
      email: row.userEmail,
      name: row.userName,
    },
  }));
}

export async function deactivateMember(
  memberId: string,
  organizationId: string,
  requesterId: string,
  requesterRole: "owner" | "admin" | "member" = "member"
): Promise<{ success: boolean; error?: string }> {
  const memberToDeactivate = await db
    .select()
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.organizationId, organizationId)))
    .limit(1);

  if (memberToDeactivate.length === 0) {
    return { success: false, error: "Member not found" };
  }

  if (memberToDeactivate[0].userId === requesterId) {
    return { success: false, error: "Cannot deactivate yourself" };
  }

  if (memberToDeactivate[0].role === "owner") {
    return { success: false, error: "Cannot deactivate the owner" };
  }

  if (requesterRole === "admin" && memberToDeactivate[0].role === "admin") {
    return { success: false, error: "Admins cannot deactivate other admins" };
  }

  await db
    .update(members)
    .set({ deactivatedAt: new Date() })
    .where(and(eq(members.id, memberId), eq(members.organizationId, organizationId)));

  return { success: true };
}

export async function updateMemberRole(
  memberId: string,
  organizationId: string,
  newRole: "admin" | "member"
): Promise<{ success: boolean; error?: string }> {
  const memberToUpdate = await db
    .select()
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.organizationId, organizationId)))
    .limit(1);

  if (memberToUpdate.length === 0) {
    return { success: false, error: "Member not found" };
  }

  if (memberToUpdate[0].role === "owner") {
    return { success: false, error: "Cannot change owner's role" };
  }

  await db
    .update(members)
    .set({ role: newRole })
    .where(and(eq(members.id, memberId), eq(members.organizationId, organizationId)));

  return { success: true };
}

export async function reactivateMember(
  memberId: string,
  organizationId: string
): Promise<{ success: boolean; error?: string }> {
  // Get the member to reactivate
  const memberToReactivate = await db
    .select()
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.organizationId, organizationId)))
    .limit(1);

  if (memberToReactivate.length === 0) {
    return { success: false, error: "Member not found" };
  }

  await db
    .update(members)
    .set({ deactivatedAt: null })
    .where(and(eq(members.id, memberId), eq(members.organizationId, organizationId)));

  return { success: true };
}
