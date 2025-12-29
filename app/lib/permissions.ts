export type Role = "owner" | "admin" | "member";

export function canManageOrganization(role: Role | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function canImpersonate(
  actorRole: Role | undefined,
  targetRole: Role
): boolean {
  if (!actorRole) return false;

  if (actorRole === "owner") {
    return targetRole !== "owner";
  }

  if (actorRole === "admin") {
    return targetRole === "member";
  }

  return false;
}

export function canDeactivateMember(
  actorRole: Role | undefined,
  targetRole: Role
): boolean {
  if (!actorRole) return false;

  if (actorRole === "owner") {
    return targetRole !== "owner";
  }

  if (actorRole === "admin") {
    return targetRole === "member";
  }

  return false;
}

export function canCreateInvitationWithRole(
  actorRole: Role | undefined,
  inviteRole: Role
): boolean {
  if (actorRole === "owner") {
    return true;
  }

  if (actorRole === "admin") {
    return inviteRole === "member";
  }

  return false;
}

export function getRoleBadgeStyle(role: Role): string {
  switch (role) {
    case "owner":
      return "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400";
    case "admin":
      return "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400";
    default:
      return "bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400";
  }
}
