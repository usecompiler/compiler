import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "~/test-utils/mock-db";

const mockDb = createMockDb();

vi.mock("~/lib/db/index.server", () => ({ db: mockDb }));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _op: "eq", args }),
  and: (...args: unknown[]) => ({ _op: "and", args }),
  asc: (col: unknown) => ({ _op: "asc", col }),
}));

vi.mock("~/lib/db/schema", () => ({
  projects: {
    id: "projects.id",
    name: "projects.name",
    organizationId: "projects.organizationId",
    createdAt: "projects.createdAt",
    updatedAt: "projects.updatedAt",
  },
  projectRepositories: {
    id: "projectRepositories.id",
    projectId: "projectRepositories.projectId",
    repositoryId: "projectRepositories.repositoryId",
  },
  repositories: {
    id: "repositories.id",
    name: "repositories.name",
    fullName: "repositories.fullName",
    cloneUrl: "repositories.cloneUrl",
    isPrivate: "repositories.isPrivate",
    cloneStatus: "repositories.cloneStatus",
    organizationId: "repositories.organizationId",
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockDb._selectCallCount = 0;
  mockDb._selectResults = [[]];
  mockDb._insertValues.mockImplementation(() => {
    const p = Promise.resolve(undefined);
    (p as unknown as Record<string, unknown>).onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    return p;
  });
  mockDb._updateSet.mockClear();
  mockDb._updateWhere.mockResolvedValue(undefined);
  mockDb._deleteWhere.mockResolvedValue(undefined);
});

describe("updateProject", () => {
  it("scopes update by organizationId", async () => {
    const { updateProject } = await import("./projects.server");
    await updateProject("proj-1", "org-1", "New Name");

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New Name" })
    );

    const whereArg = mockDb._updateWhere.mock.calls[0][0];
    expect(whereArg._op).toBe("and");
    const eqOps = whereArg.args;
    expect(eqOps).toHaveLength(2);
    expect(eqOps[0]).toEqual({ _op: "eq", args: ["projects.id", "proj-1"] });
    expect(eqOps[1]).toEqual({ _op: "eq", args: ["projects.organizationId", "org-1"] });
  });
});

describe("deleteProject", () => {
  it("returns error when project not found in org", async () => {
    mockDb._selectResults = [[]];
    const { deleteProject } = await import("./projects.server");
    const result = await deleteProject("proj-1", "org-1");

    expect(result).toEqual({ success: false, error: "Project not found" });
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("scopes delete by organizationId", async () => {
    const now = new Date();
    mockDb._selectResults = [
      [{ id: "proj-1", name: "P1", organizationId: "org-1", createdAt: now, updatedAt: now },
       { id: "proj-2", name: "P2", organizationId: "org-1", createdAt: now, updatedAt: now }],
    ];

    const { deleteProject } = await import("./projects.server");
    const result = await deleteProject("proj-1", "org-1");

    expect(result).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalled();

    const whereArg = mockDb._deleteWhere.mock.calls[0][0];
    expect(whereArg._op).toBe("and");
    const eqOps = whereArg.args;
    expect(eqOps[0]).toEqual({ _op: "eq", args: ["projects.id", "proj-1"] });
    expect(eqOps[1]).toEqual({ _op: "eq", args: ["projects.organizationId", "org-1"] });
  });

  it("prevents deleting from wrong org", async () => {
    mockDb._selectResults = [[]];
    const { deleteProject } = await import("./projects.server");
    const result = await deleteProject("proj-1", "wrong-org");

    expect(result).toEqual({ success: false, error: "Project not found" });
    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});

describe("addRepoToProject", () => {
  it("validates both project and repo belong to org", async () => {
    mockDb._selectResults = [
      [{ id: "proj-1" }],
      [{ id: "repo-1" }],
    ];

    const { addRepoToProject } = await import("./projects.server");
    await addRepoToProject("proj-1", "repo-1", "org-1");

    expect(mockDb.insert).toHaveBeenCalled();

    const firstSelectWhere = mockDb._selectWhere.mock.calls[0][0];
    expect(firstSelectWhere._op).toBe("and");
    expect(firstSelectWhere.args[1]).toEqual({ _op: "eq", args: ["projects.organizationId", "org-1"] });

    const secondSelectWhere = mockDb._selectWhere.mock.calls[1][0];
    expect(secondSelectWhere._op).toBe("and");
    expect(secondSelectWhere.args[1]).toEqual({ _op: "eq", args: ["repositories.organizationId", "org-1"] });
  });

  it("throws when project belongs to different org", async () => {
    mockDb._selectResults = [
      [],
      [{ id: "repo-1" }],
    ];

    const { addRepoToProject } = await import("./projects.server");
    await expect(addRepoToProject("proj-1", "repo-1", "wrong-org"))
      .rejects.toThrow("Project or repository not found");
  });

  it("throws when repo belongs to different org", async () => {
    mockDb._selectResults = [
      [{ id: "proj-1" }],
      [],
    ];

    const { addRepoToProject } = await import("./projects.server");
    await expect(addRepoToProject("proj-1", "repo-1", "wrong-org"))
      .rejects.toThrow("Project or repository not found");
  });
});

describe("removeRepoFromProject", () => {
  it("validates both project and repo belong to org before removing", async () => {
    mockDb._selectResults = [
      [{ id: "proj-1" }],
      [{ id: "repo-1" }],
    ];

    const { removeRepoFromProject } = await import("./projects.server");
    await removeRepoFromProject("proj-1", "repo-1", "org-1");

    const firstSelectWhere = mockDb._selectWhere.mock.calls[0][0];
    expect(firstSelectWhere._op).toBe("and");
    expect(firstSelectWhere.args[1]).toEqual({ _op: "eq", args: ["projects.organizationId", "org-1"] });

    const secondSelectWhere = mockDb._selectWhere.mock.calls[1][0];
    expect(secondSelectWhere._op).toBe("and");
    expect(secondSelectWhere.args[1]).toEqual({ _op: "eq", args: ["repositories.organizationId", "org-1"] });

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("throws when project belongs to different org", async () => {
    mockDb._selectResults = [
      [],
      [{ id: "repo-1" }],
    ];

    const { removeRepoFromProject } = await import("./projects.server");
    await expect(removeRepoFromProject("proj-1", "repo-1", "wrong-org"))
      .rejects.toThrow("Project or repository not found");
  });

  it("throws when repo belongs to different org", async () => {
    mockDb._selectResults = [
      [{ id: "proj-1" }],
      [],
    ];

    const { removeRepoFromProject } = await import("./projects.server");
    await expect(removeRepoFromProject("proj-1", "repo-1", "wrong-org"))
      .rejects.toThrow("Project or repository not found");
  });
});

describe("getProjectRepos", () => {
  it("scopes query by organizationId via projects join", async () => {
    mockDb._selectResults = [[]];

    const { getProjectRepos } = await import("./projects.server");
    await getProjectRepos("proj-1", "org-1");

    expect(mockDb._selectFrom).toHaveBeenCalled();

    const whereArg = mockDb._selectWhere.mock.calls[0][0];
    expect(whereArg._op).toBe("and");
    expect(whereArg.args[0]).toEqual({ _op: "eq", args: ["projectRepositories.projectId", "proj-1"] });
    expect(whereArg.args[1]).toEqual({ _op: "eq", args: ["projects.organizationId", "org-1"] });
  });
});
