import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/app-layout";
import { requireActiveAuth, type Organization, type Membership } from "~/lib/auth.server";
import { getConversations, getConversationProjectId, getMostRecentProjectId, isUserInOrg, type ConversationMeta, type Item } from "~/lib/conversations.server";
import { getMembers, type Member } from "~/lib/invitations.server";
import { canManageOrganization, canImpersonate } from "~/lib/permissions.server";
import { getModelConfig, getUserPreferredModel, getDisplayName, DEFAULT_MODEL_ID } from "~/lib/models.server";
import { getStorageConfigPublic } from "~/lib/storage.server";
import { getProjects, type ProjectMeta } from "~/lib/projects.server";
import { isSaas } from "~/lib/appMode.server";

function getModelDisplayName(id: string): string {
  return getDisplayName(id);
}

export type { Item, ConversationMeta, Organization, Membership, Member, ProjectMeta };

export interface ImpersonatingUser {
  id: string;
  name: string;
  email: string;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const isOwner = user.membership?.role === "owner";
  const isAdmin = user.membership?.role === "admin";
  const canManageOrg = canManageOrganization(user.membership?.role);

  if (user.organization && !user.organization.onboardingCompleted && isOwner) {
    throw redirect(isSaas() ? "/onboarding/github" : "/onboarding/github-app");
  }

  const url = new URL(request.url);
  const impersonateUserId = url.searchParams.get("impersonate");

  let impersonating: ImpersonatingUser | null = null;
  let orgMembers: Member[] = [];
  let conversations: ConversationMeta[] = [];
  let hasMore = false;
  let availableModels: { id: string; displayName: string }[] = [];
  let defaultModel = DEFAULT_MODEL_ID;
  let userPreferredModel: string | null = null;
  let hasStorageConfig = false;
  let projectsList: ProjectMeta[] = [];
  let activeProject: ProjectMeta | null = null;

  if (user.organization) {
    projectsList = await getProjects(user.organization.id);

    const conversationMatch = url.pathname.match(/^\/c\/(.+)/);
    let resolvedProjectId: string | null = null;

    if (conversationMatch) {
      resolvedProjectId = await getConversationProjectId(conversationMatch[1]);
    }

    if (!resolvedProjectId) {
      resolvedProjectId = url.searchParams.get("project");
    }

    if (!resolvedProjectId) {
      resolvedProjectId = await getMostRecentProjectId(user.id);
    }

    activeProject =
      projectsList.find((p) => p.id === resolvedProjectId) || projectsList[0] || null;

    const storageConfig = await getStorageConfigPublic(user.organization.id);
    hasStorageConfig = storageConfig !== null;
    if (canManageOrg) {
      const allMembers = await getMembers(user.organization.id);
      orgMembers = allMembers;
    }

    const modelConfig = await getModelConfig(user.organization.id);
    if (modelConfig) {
      defaultModel = modelConfig.defaultModel;
      availableModels = modelConfig.availableModels.map((id) => ({
        id,
        displayName: getModelDisplayName(id),
      }));

      if (user.membership) {
        const preferred = await getUserPreferredModel(user.membership.id);
        if (preferred && modelConfig.availableModels.includes(preferred)) {
          userPreferredModel = preferred;
        }
      }
    }
  }

  if (impersonateUserId && canManageOrg && user.organization) {
    const isInOrg = await isUserInOrg(impersonateUserId, user.organization.id);
    if (isInOrg) {
      const targetMember = orgMembers.find((m) => m.userId === impersonateUserId);
      if (targetMember && canImpersonate(user.membership?.role, targetMember.role)) {
        impersonating = {
          id: targetMember.userId,
          name: targetMember.user.name,
          email: targetMember.user.email,
        };
        const result = await getConversations(impersonateUserId, {
          projectId: activeProject?.id,
        });
        conversations = result.conversations;
        hasMore = result.hasMore;
      }
    }
  }

  if (!impersonating) {
    const result = await getConversations(user.id, {
      projectId: activeProject?.id,
    });
    conversations = result.conversations;
    hasMore = result.hasMore;
  }

  return {
    user,
    conversations,
    hasMore,
    impersonating,
    orgMembers,
    isOwner,
    isAdmin,
    availableModels,
    defaultModel,
    userPreferredModel,
    hasStorageConfig,
    projects: projectsList,
    activeProject,
  };
}

export interface ModelOption {
  id: string;
  displayName: string;
}

export interface AppContext {
  user: {
    id: string;
    email: string;
    name: string;
    organization: Organization | null;
    membership: Membership | null;
  };
  conversations: ConversationMeta[];
  hasMore: boolean;
  impersonating: ImpersonatingUser | null;
  orgMembers: Member[];
  isOwner: boolean;
  isAdmin: boolean;
  availableModels: ModelOption[];
  defaultModel: string;
  userPreferredModel: string | null;
  hasStorageConfig: boolean;
  projects: ProjectMeta[];
  activeProject: ProjectMeta | null;
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const context: AppContext = {
    user: loaderData.user,
    conversations: loaderData.conversations,
    hasMore: loaderData.hasMore,
    impersonating: loaderData.impersonating,
    orgMembers: loaderData.orgMembers,
    isOwner: loaderData.isOwner,
    isAdmin: loaderData.isAdmin,
    availableModels: loaderData.availableModels,
    defaultModel: loaderData.defaultModel,
    userPreferredModel: loaderData.userPreferredModel,
    hasStorageConfig: loaderData.hasStorageConfig,
    projects: loaderData.projects,
    activeProject: loaderData.activeProject,
  };

  return <Outlet context={context} />;
}
