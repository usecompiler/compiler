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
  repositories: {
    id: "repositories.id",
    name: "repositories.name",
    cloneUrl: "repositories.cloneUrl",
    isPrivate: "repositories.isPrivate",
    cloneStatus: "repositories.cloneStatus",
    clonedAt: "repositories.clonedAt",
    lastSyncedAt: "repositories.lastSyncedAt",
    organizationId: "repositories.organizationId",
  },
  projectRepositories: {
    projectId: "projectRepositories.projectId",
    repositoryId: "projectRepositories.repositoryId",
  },
}));

const mockCloneRepository = vi.fn().mockResolvedValue(undefined);
const mockClonePublicRepository = vi.fn().mockResolvedValue(undefined);
const mockPullRepository = vi.fn().mockResolvedValue(undefined);
const mockPullPublicRepository = vi.fn().mockResolvedValue(undefined);
const mockRepoExists = vi.fn().mockReturnValue(true);

vi.mock("~/lib/clone.server", () => ({
  cloneRepository: (...args: unknown[]) => mockCloneRepository(...args),
  clonePublicRepository: (...args: unknown[]) => mockClonePublicRepository(...args),
  pullRepository: (...args: unknown[]) => mockPullRepository(...args),
  pullPublicRepository: (...args: unknown[]) => mockPullPublicRepository(...args),
  repoExists: (...args: unknown[]) => mockRepoExists(...args),
}));

vi.mock("~/lib/appMode.server", () => ({
  isSaas: () => false,
}));

vi.mock("~/lib/github.server", () => ({
  getOrRefreshAccessToken: vi.fn().mockResolvedValue("test-token"),
}));

const options = { organizationId: "org-1", projectId: "proj-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockDb._selectCallCount = 0;
  mockRepoExists.mockReturnValue(true);
});

describe("executeRepoSync", () => {
  let executeRepoSync: typeof import("./repo-sync.server").executeRepoSync;

  beforeEach(async () => {
    const mod = await import("./repo-sync.server");
    executeRepoSync = mod.executeRepoSync;
  });

  it("returns message when no repos configured", async () => {
    mockDb._setSelectResult([]);
    const result = await executeRepoSync({ action: "status" }, options);
    expect(result).toBe("No repositories configured for this project.");
  });

  it("status returns repo with completed status", async () => {
    mockDb._setSelectResult([
      { id: "r1", name: "my-repo", cloneUrl: "https://github.com/org/my-repo.git", isPrivate: false, cloneStatus: "completed", clonedAt: new Date(), lastSyncedAt: new Date() },
    ]);
    const result = await executeRepoSync({ action: "status" }, options);
    expect(result).toContain("my-repo: completed");
    expect(result).toContain("last synced 0m ago");
  });

  it("status returns pending repo", async () => {
    mockDb._setSelectResult([
      { id: "r1", name: "my-repo", cloneUrl: "https://github.com/org/my-repo.git", isPrivate: false, cloneStatus: "pending", clonedAt: null, lastSyncedAt: null },
    ]);
    const result = await executeRepoSync({ action: "status" }, options);
    expect(result).toBe("my-repo: pending");
  });

  it("status returns completed repo without filesystem check", async () => {
    mockRepoExists.mockReturnValue(false);
    mockDb._setSelectResult([
      { id: "r1", name: "my-repo", cloneUrl: "https://github.com/org/my-repo.git", isPrivate: false, cloneStatus: "completed", clonedAt: new Date(), lastSyncedAt: null },
    ]);
    const result = await executeRepoSync({ action: "status" }, options);
    expect(result).toContain("my-repo: completed");
    expect(mockRepoExists).not.toHaveBeenCalled();
  });

  it("sync clones a pending public repo", async () => {
    mockDb._setSelectResult([
      { id: "r1", name: "my-repo", cloneUrl: "https://github.com/org/my-repo.git", isPrivate: false, cloneStatus: "pending", clonedAt: null, lastSyncedAt: null },
    ]);
    const result = await executeRepoSync({ action: "sync" }, options);
    expect(result).toBe("my-repo: cloned successfully");
    expect(mockClonePublicRepository).toHaveBeenCalledWith("org-1", "r1", "my-repo", "https://github.com/org/my-repo.git");
  });

  it("sync clones a pending private repo", async () => {
    mockDb._setSelectResult([
      { id: "r1", name: "my-repo", cloneUrl: "https://github.com/org/my-repo.git", isPrivate: true, cloneStatus: "pending", clonedAt: null, lastSyncedAt: null },
    ]);
    const result = await executeRepoSync({ action: "sync" }, options);
    expect(result).toBe("my-repo: cloned successfully");
    expect(mockCloneRepository).toHaveBeenCalledWith("org-1", "r1", "my-repo", "https://github.com/org/my-repo.git");
  });

  it("sync clones a failed repo", async () => {
    mockDb._setSelectResult([
      { id: "r1", name: "my-repo", cloneUrl: "https://github.com/org/my-repo.git", isPrivate: false, cloneStatus: "failed", clonedAt: null, lastSyncedAt: null },
    ]);
    const result = await executeRepoSync({ action: "sync" }, options);
    expect(result).toBe("my-repo: cloned successfully");
    expect(mockClonePublicRepository).toHaveBeenCalled();
  });

  it("sync reports clone failure", async () => {
    mockClonePublicRepository.mockRejectedValueOnce(new Error("network error"));
    mockDb._setSelectResult([
      { id: "r1", name: "my-repo", cloneUrl: "https://github.com/org/my-repo.git", isPrivate: false, cloneStatus: "pending", clonedAt: null, lastSyncedAt: null },
    ]);
    const result = await executeRepoSync({ action: "sync" }, options);
    expect(result).toBe("my-repo: clone failed - network error");
  });

  it("sync pulls stale completed repo", async () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    mockDb._setSelectResult([
      { id: "r1", name: "my-repo", cloneUrl: "https://github.com/org/my-repo.git", isPrivate: false, cloneStatus: "completed", clonedAt: staleDate, lastSyncedAt: null },
    ]);
    const result = await executeRepoSync({ action: "sync" }, options);
    expect(result).toBe("my-repo: pulled latest changes");
    expect(mockPullPublicRepository).toHaveBeenCalledWith("org-1", "my-repo");
  });

  it("sync pulls stale private repo", async () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    mockDb._setSelectResult([
      { id: "r1", name: "my-repo", cloneUrl: "https://github.com/org/my-repo.git", isPrivate: true, cloneStatus: "completed", clonedAt: staleDate, lastSyncedAt: null },
    ]);
    const result = await executeRepoSync({ action: "sync" }, options);
    expect(result).toBe("my-repo: pulled latest changes");
    expect(mockPullRepository).toHaveBeenCalledWith("org-1", "my-repo");
  });

  it("sync skips fresh completed repo", async () => {
    mockDb._setSelectResult([
      { id: "r1", name: "my-repo", cloneUrl: "https://github.com/org/my-repo.git", isPrivate: false, cloneStatus: "completed", clonedAt: new Date(), lastSyncedAt: new Date() },
    ]);
    const result = await executeRepoSync({ action: "sync" }, options);
    expect(result).toBe("my-repo: up to date");
    expect(mockPullPublicRepository).not.toHaveBeenCalled();
    expect(mockPullRepository).not.toHaveBeenCalled();
  });

  it("sync skips repo currently cloning", async () => {
    mockDb._setSelectResult([
      { id: "r1", name: "my-repo", cloneUrl: "https://github.com/org/my-repo.git", isPrivate: false, cloneStatus: "cloning", clonedAt: null, lastSyncedAt: null },
    ]);
    const result = await executeRepoSync({ action: "sync" }, options);
    expect(result).toBe("my-repo: currently cloning, please wait");
    expect(mockClonePublicRepository).not.toHaveBeenCalled();
  });

  it("sync targets a specific repo by name", async () => {
    mockDb._setSelectResult([
      { id: "r1", name: "repo-a", cloneUrl: "https://github.com/org/repo-a.git", isPrivate: false, cloneStatus: "completed", clonedAt: new Date(), lastSyncedAt: new Date() },
      { id: "r2", name: "repo-b", cloneUrl: "https://github.com/org/repo-b.git", isPrivate: false, cloneStatus: "pending", clonedAt: null, lastSyncedAt: null },
    ]);
    const result = await executeRepoSync({ action: "sync", repoName: "repo-b" }, options);
    expect(result).toBe("repo-b: cloned successfully");
    expect(mockClonePublicRepository).toHaveBeenCalledTimes(1);
  });

  it("sync returns not found for unknown repo name", async () => {
    mockDb._setSelectResult([
      { id: "r1", name: "repo-a", cloneUrl: "https://github.com/org/repo-a.git", isPrivate: false, cloneStatus: "completed", clonedAt: new Date(), lastSyncedAt: new Date() },
    ]);
    const result = await executeRepoSync({ action: "sync", repoName: "nonexistent" }, options);
    expect(result).toBe('Repository "nonexistent" not found in this project.');
  });

  it("sync clones repo missing from disk even if status is completed", async () => {
    mockRepoExists.mockReturnValue(false);
    mockDb._setSelectResult([
      { id: "r1", name: "my-repo", cloneUrl: "https://github.com/org/my-repo.git", isPrivate: false, cloneStatus: "completed", clonedAt: new Date(), lastSyncedAt: new Date() },
    ]);
    const result = await executeRepoSync({ action: "sync" }, options);
    expect(result).toBe("my-repo: cloned successfully");
    expect(mockClonePublicRepository).toHaveBeenCalled();
  });

  it("sync handles multiple repos", async () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    mockDb._setSelectResult([
      { id: "r1", name: "repo-a", cloneUrl: "https://github.com/org/repo-a.git", isPrivate: false, cloneStatus: "pending", clonedAt: null, lastSyncedAt: null },
      { id: "r2", name: "repo-b", cloneUrl: "https://github.com/org/repo-b.git", isPrivate: false, cloneStatus: "completed", clonedAt: staleDate, lastSyncedAt: null },
    ]);
    const result = await executeRepoSync({ action: "sync" }, options);
    expect(result).toContain("repo-a: cloned successfully");
    expect(result).toContain("repo-b: pulled latest changes");
  });

  it("sync reports pull failure", async () => {
    mockPullPublicRepository.mockRejectedValueOnce(new Error("auth expired"));
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    mockDb._setSelectResult([
      { id: "r1", name: "my-repo", cloneUrl: "https://github.com/org/my-repo.git", isPrivate: false, cloneStatus: "completed", clonedAt: staleDate, lastSyncedAt: null },
    ]);
    const result = await executeRepoSync({ action: "sync" }, options);
    expect(result).toBe("my-repo: pull failed - auth expired");
  });
});
