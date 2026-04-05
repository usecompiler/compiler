import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db/index.server", () => ({ db: {} }));
vi.mock("~/lib/db/schema", () => ({
  repositories: {},
  projectRepositories: {},
}));
vi.mock("~/lib/clone.server", () => ({
  cloneRepository: vi.fn(),
  clonePublicRepository: vi.fn(),
  pullRepository: vi.fn(),
  pullPublicRepository: vi.fn(),
  repoExists: vi.fn(),
}));
vi.mock("~/lib/appMode.server", () => ({ isSaas: () => false }));
vi.mock("~/lib/github.server", () => ({ getOrRefreshAccessToken: vi.fn() }));
vi.mock("~/lib/projects.server", () => ({ getOrgRepos: vi.fn().mockResolvedValue([]) }));

import { truncateForModel, buildTools } from "./index.server";

describe("truncateForModel", () => {
  it("passes through output under the limit unchanged", () => {
    const result = truncateForModel("short output", 5000);
    expect(result).toEqual({ type: "text", value: "short output" });
  });

  it("passes through output exactly at the limit", () => {
    const output = "x".repeat(5000);
    const result = truncateForModel(output, 5000);
    expect(result).toEqual({ type: "text", value: output });
  });

  it("truncates at a line boundary", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const output = lines.join("\n");
    const result = truncateForModel(output, 200);
    expect(result.value).not.toContain("line 100");
    expect(result.value).toContain("\n\n[Truncated: showing ");
    const shown = result.value.split("\n\n[Truncated:")[0];
    expect(shown.endsWith("\n")).toBe(false);
  });

  it("includes correct line counts in truncation message", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `match ${i + 1}: some/file.ts`);
    const output = lines.join("\n");
    const result = truncateForModel(output, 100);
    const match = result.value.match(
      /\[Truncated: showing (\d+) of (\d+) lines\]/,
    );
    expect(match).not.toBeNull();
    const shownLines = parseInt(match![1]);
    const totalLines = parseInt(match![2]);
    expect(totalLines).toBe(50);
    expect(shownLines).toBeLessThan(totalLines);
    expect(shownLines).toBeGreaterThan(0);
  });

  it("handles output with no newlines", () => {
    const output = "x".repeat(200);
    const result = truncateForModel(output, 100);
    expect(result.type).toBe("text");
    expect(result.value).toContain("[Truncated: showing 1 of 1 lines]");
  });
});

describe("buildTools toModelOutput", () => {
  const options = {
    cwd: "/tmp",
    allowedDirs: ["/tmp"],
    enabledTools: ["grep", "glob", "read", "bash"],
    organizationId: "test-org",
    projectId: null,
  };

  it("grep has toModelOutput configured", () => {
    const tools = buildTools(options);
    expect(tools.grep).toBeDefined();
    expect((tools.grep as any).toModelOutput).toBeDefined();
  });

  it("glob has toModelOutput configured", () => {
    const tools = buildTools(options);
    expect(tools.glob).toBeDefined();
    expect((tools.glob as any).toModelOutput).toBeDefined();
  });

  it("read does not have toModelOutput", () => {
    const tools = buildTools(options);
    expect(tools.read).toBeDefined();
    expect((tools.read as any).toModelOutput).toBeUndefined();
  });

  it("bash does not have toModelOutput", () => {
    const tools = buildTools(options);
    expect(tools.bash).toBeDefined();
    expect((tools.bash as any).toModelOutput).toBeUndefined();
  });
});
