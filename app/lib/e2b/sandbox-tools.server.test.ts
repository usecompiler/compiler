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
vi.mock("~/lib/appMode.server", () => ({ isSaas: () => true }));
vi.mock("~/lib/github.server", () => ({ getOrRefreshAccessToken: vi.fn() }));
vi.mock("~/lib/projects.server", () => ({ getOrgRepos: vi.fn().mockResolvedValue([]) }));

const executeRepoSync = vi.fn().mockResolvedValue("synced");
vi.mock("~/lib/tools/repo-sync.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/tools/repo-sync.server")>()),
  executeRepoSync: (...args: unknown[]) => executeRepoSync(...args),
}));

import type { Sandbox } from "@e2b/code-interpreter";
import { buildSandboxTools } from "./sandbox-tools.server";

interface MockHandle {
  wait: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
}

function mockSandbox(handle: MockHandle) {
  return {
    commands: { run: vi.fn().mockResolvedValue(handle) },
    files: { read: vi.fn().mockResolvedValue("file content") },
  } as unknown as Sandbox;
}

function buildTools(sandbox: Sandbox) {
  return buildSandboxTools({
    sandbox,
    cwd: "/repos",
    enabledTools: ["bash", "grep", "glob", "read"],
    organizationId: "org-1",
  });
}

function execOptions(abortSignal?: AbortSignal) {
  return { toolCallId: "tc-1", messages: [], abortSignal } as never;
}

describe("buildSandboxTools abort handling", () => {
  it("runs commands in the background and returns their output", async () => {
    const handle: MockHandle = {
      wait: vi.fn().mockResolvedValue({ stdout: "hello", stderr: "" }),
      kill: vi.fn(),
    };
    const sandbox = mockSandbox(handle);
    const tools = buildTools(sandbox);

    const output = await tools.bash.execute!({ command: "echo hello", description: "greet" }, execOptions());

    expect(output).toBe("hello");
    expect(sandbox.commands.run).toHaveBeenCalledWith(
      "echo hello",
      expect.objectContaining({ background: true, cwd: "/repos" }),
    );
    expect(handle.kill).not.toHaveBeenCalled();
  });

  it("kills the running command when the signal aborts", async () => {
    let killed = false;
    let rejectWait: ((err: Error) => void) | null = null;
    const handle: MockHandle = {
      wait: vi.fn().mockImplementation(
        () => new Promise((_, reject) => {
          if (killed) {
            reject(new Error("command killed"));
            return;
          }
          rejectWait = reject;
        }),
      ),
      kill: vi.fn().mockImplementation(async () => {
        killed = true;
        rejectWait?.(new Error("command killed"));
        return true;
      }),
    };
    const sandbox = mockSandbox(handle);
    const tools = buildTools(sandbox);
    const controller = new AbortController();

    const pending = tools.bash.execute!(
      { command: "sleep 100", description: "wait" },
      execOptions(controller.signal),
    );
    controller.abort();
    const output = await pending;

    expect(handle.kill).toHaveBeenCalledOnce();
    expect(output).toContain("Error:");
  });

  it("does not start a command when the signal is already aborted", async () => {
    const handle: MockHandle = { wait: vi.fn(), kill: vi.fn() };
    const sandbox = mockSandbox(handle);
    const tools = buildTools(sandbox);
    const controller = new AbortController();
    controller.abort();

    const output = await tools.bash.execute!(
      { command: "echo hi", description: "greet" },
      execOptions(controller.signal),
    );

    expect(sandbox.commands.run).not.toHaveBeenCalled();
    expect(output).toContain("Error:");
  });

  it("passes the abort signal through to repoSync", async () => {
    const handle: MockHandle = { wait: vi.fn(), kill: vi.fn() };
    const sandbox = mockSandbox(handle);
    const tools = buildTools(sandbox);
    const controller = new AbortController();

    await tools.repoSync.execute!({ repositories: [] }, execOptions(controller.signal));

    expect(executeRepoSync).toHaveBeenCalledWith(
      { repositories: [] },
      expect.objectContaining({ signal: controller.signal, sandbox }),
    );
  });
});
