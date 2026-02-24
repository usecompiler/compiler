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
  name: string
): Promise<void> {
  await db
    .update(projects)
    .set({ name, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

export async function deleteProject(projectId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const project = await getProject(projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  const orgProjects = await getProjects(project.organizationId);
  if (orgProjects.length <= 1) {
    return { success: false, error: "Cannot delete the last project" };
  }

  await db.delete(projects).where(eq(projects.id, projectId));
  return { success: true };
}

export async function addRepoToProject(
  projectId: string,
  repositoryId: string
): Promise<void> {
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
  repositoryId: string
): Promise<void> {
  await db
    .delete(projectRepositories)
    .where(
      and(
        eq(projectRepositories.projectId, projectId),
        eq(projectRepositories.repositoryId, repositoryId)
      )
    );
}

export async function getProjectRepos(projectId: string) {
  return db
    .select({
      id: repositories.id,
      name: repositories.name,
      fullName: repositories.fullName,
      cloneUrl: repositories.cloneUrl,
      isPrivate: repositories.isPrivate,
      cloneStatus: repositories.cloneStatus,
    })
    .from(projectRepositories)
    .innerJoin(
      repositories,
      eq(projectRepositories.repositoryId, repositories.id)
    )
    .where(eq(projectRepositories.projectId, projectId))
    .orderBy(asc(repositories.name));
}

