import { db } from "~/lib/db/index.server";
import {
  projects,
  projectRepositories,
  repositories,
} from "~/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";

export interface ProjectMeta {
  id: string;
  name: string;
  organizationId: string;
  createdAt: number;
  updatedAt: number;
}

export async function getProjects(
  organizationId: string
): Promise<ProjectMeta[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      organizationId: projects.organizationId,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
    .orderBy(asc(projects.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    organizationId: r.organizationId,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  }));
}

export async function getProject(
  projectId: string
): Promise<ProjectMeta | null> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      organizationId: projects.organizationId,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    organizationId: r.organizationId,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

export async function createProject(
  organizationId: string,
  name: string
): Promise<ProjectMeta> {
  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(projects).values({
    id,
    organizationId,
    name,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    name,
    organizationId,
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
  };
}

export async function updateProject(
  projectId: string,
  organizationId: string,
  name: string
): Promise<void> {
  await db
    .update(projects)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)));
}

export async function deleteProject(
  projectId: string,
  organizationId: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  const orgProjects = await getProjects(organizationId);

  if (!orgProjects.some((p) => p.id === projectId)) {
    return { success: false, error: "Project not found" };
  }

  if (orgProjects.length <= 1) {
    return { success: false, error: "Cannot delete the last project" };
  }

  await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)));
  return { success: true };
}

export async function addRepoToProject(
  projectId: string,
  repositoryId: string,
  organizationId: string
): Promise<void> {
  const [proj, repo] = await Promise.all([
    db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .limit(1),
    db.select({ id: repositories.id }).from(repositories)
      .where(and(eq(repositories.id, repositoryId), eq(repositories.organizationId, organizationId)))
      .limit(1),
  ]);

  if (!proj[0] || !repo[0]) {
    throw new Error("Project or repository not found");
  }

  await db
    .insert(projectRepositories)
    .values({
      id: crypto.randomUUID(),
      projectId,
      repositoryId,
    })
    .onConflictDoNothing();
}

export async function removeRepoFromProject(
  projectId: string,
  repositoryId: string,
  organizationId: string
): Promise<void> {
  const [proj, repo] = await Promise.all([
    db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .limit(1),
    db.select({ id: repositories.id }).from(repositories)
      .where(and(eq(repositories.id, repositoryId), eq(repositories.organizationId, organizationId)))
      .limit(1),
  ]);

  if (!proj[0] || !repo[0]) {
    throw new Error("Project or repository not found");
  }

  await db
    .delete(projectRepositories)
    .where(
      and(
        eq(projectRepositories.projectId, projectId),
        eq(projectRepositories.repositoryId, repositoryId)
      )
    );
}

const repoColumns = {
  id: repositories.id,
  name: repositories.name,
  fullName: repositories.fullName,
  cloneUrl: repositories.cloneUrl,
  isPrivate: repositories.isPrivate,
  cloneStatus: repositories.cloneStatus,
  clonedAt: repositories.clonedAt,
  lastSyncedAt: repositories.lastSyncedAt,
};

export async function getProjectRepos(projectId: string, organizationId: string) {
  return db
    .select(repoColumns)
    .from(projectRepositories)
    .innerJoin(
      repositories,
      eq(projectRepositories.repositoryId, repositories.id)
    )
    .innerJoin(
      projects,
      eq(projectRepositories.projectId, projects.id)
    )
    .where(and(eq(projectRepositories.projectId, projectId), eq(projects.organizationId, organizationId)))
    .orderBy(asc(repositories.name));
}

export async function getOrgRepos(organizationId: string, projectId?: string | null) {
  if (projectId) {
    return db
      .select(repoColumns)
      .from(projectRepositories)
      .innerJoin(repositories, eq(projectRepositories.repositoryId, repositories.id))
      .where(eq(projectRepositories.projectId, projectId))
      .orderBy(asc(repositories.name));
  }

  return db
    .select(repoColumns)
    .from(repositories)
    .where(eq(repositories.organizationId, organizationId))
    .orderBy(asc(repositories.name));
}

