import { tool, type Tool } from "ai";
import path from "node:path";
import type { Sandbox } from "@e2b/code-interpreter";
import { bashDescription, bashParameters, MAX_OUTPUT_CHARS, DEFAULT_TIMEOUT } from "../tools/bash.server";
import { readDescription, readParameters, MAX_OUTPUT_BYTES, MAX_LINE_CHARS, DEFAULT_LIMIT } from "../tools/read.server";
import { grepDescription, grepParameters } from "../tools/grep.server";
import { globDescription, globParameters } from "../tools/glob.server";
import { askUserQuestionDescription, askUserQuestionParameters } from "../tools/ask-user-question.server";
import { repoSyncDescription, repoSyncParameters, executeRepoSync } from "../tools/repo-sync.server";
import { truncateForModel, GREP_MAX_CHARS, GLOB_MAX_CHARS } from "../tools/index.server";

function resolveSandboxPath(inputPath: string, cwd: string): string {
  if (path.isAbsolute(inputPath)) return path.normalize(inputPath);
  return path.join(cwd, inputPath);
}

async function executeSandboxBash(
  args: { command: string; timeout?: number; description: string },
  sandbox: Sandbox,
  cwd: string,
): Promise<string> {
  const timeout = args.timeout || DEFAULT_TIMEOUT;

  try {
    const result = await sandbox.commands.run(args.command, {
      timeoutMs: timeout,
      cwd,
    });

    let output = "";
    if (result.stdout) output += result.stdout;
    if (result.stderr) {
      if (output) output += "\n";
      output += `stderr: ${result.stderr}`;
    }

    if (output.length > MAX_OUTPUT_CHARS) {
      output = output.slice(0, MAX_OUTPUT_CHARS) + "\n[Output truncated]";
    }

    return output || "(no output)";
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function executeSandboxRead(
  args: { filePath: string; offset?: number; limit?: number },
  sandbox: Sandbox,
  cwd: string,
): Promise<string> {
  const filePath = resolveSandboxPath(args.filePath, cwd);

  try {
    const content = await sandbox.files.read(filePath);

    const allLines = content.split("\n");
    const offset = Math.max(0, (args.offset || 1) - 1);
    const limit = args.limit || DEFAULT_LIMIT;
    const lines = allLines.slice(offset, offset + limit);

    let output = "";
    const totalDigits = String(offset + lines.length).length;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = String(offset + i + 1).padStart(totalDigits, " ");
      const lineContent = lines[i].length > MAX_LINE_CHARS
        ? lines[i].slice(0, MAX_LINE_CHARS) + "..."
        : lines[i];
      const formatted = `${lineNum}\t${lineContent}\n`;

      if (output.length + formatted.length > MAX_OUTPUT_BYTES) {
        output += `\n[Truncated at ${MAX_OUTPUT_BYTES / 1024}KB limit]`;
        break;
      }

      output += formatted;
    }

    if (allLines.length > offset + limit) {
      output += `\n[${allLines.length - offset - limit} more lines not shown]`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

async function executeSandboxGrep(
  args: { pattern: string; path?: string; include?: string },
  sandbox: Sandbox,
  cwd: string,
): Promise<string> {
  const searchPath = args.path
    ? resolveSandboxPath(args.path, cwd)
    : cwd;

  const rgArgs = ["rg", "--json", "--max-count", "100"];
  if (args.include) rgArgs.push("--glob", shellEscape(args.include));
  rgArgs.push(shellEscape(args.pattern), shellEscape(searchPath));

  try {
    const result = await sandbox.commands.run(rgArgs.join(" "), { timeoutMs: 30_000 });
    const stdout = result.stdout || "";

    if (!stdout.trim()) {
      return result.stderr?.trim() || "No matches found.";
    }

    const lines = stdout.trim().split("\n");
    const results: string[] = [];

    for (const line of lines) {
      if (results.length >= 100) break;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "match") {
          const filePath = parsed.data?.path?.text || "";
          const lineNum = parsed.data?.line_number || 0;
          const text = parsed.data?.lines?.text?.trimEnd() || "";
          results.push(`${filePath}:${lineNum}: ${text}`);
        }
      } catch {
        continue;
      }
    }

    return results.join("\n") || "No matches found.";
  } catch {
    return "No matches found.";
  }
}

async function executeSandboxGlob(
  args: { pattern: string; path?: string },
  sandbox: Sandbox,
  cwd: string,
): Promise<string> {
  const searchPath = args.path
    ? resolveSandboxPath(args.path, cwd)
    : cwd;

  try {
    const result = await sandbox.commands.run(
      `rg --files --glob ${shellEscape(args.pattern)} ${shellEscape(searchPath)}`,
      { timeoutMs: 30_000 },
    );

    const stdout = result.stdout || "";
    if (!stdout.trim()) {
      return result.stderr?.trim() || "No files found.";
    }

    const files = stdout.trim().split("\n").slice(0, 100);
    return files.join("\n");
  } catch {
    return "No files found.";
  }
}

type AnyTool = Tool<any, any>;

interface BuildSandboxToolsOptions {
  sandbox: Sandbox;
  cwd: string;
  enabledTools: string[];
  organizationId: string;
  projectId?: string | null;
}

export function buildSandboxTools(options: BuildSandboxToolsOptions) {
  const { sandbox, cwd, enabledTools, organizationId, projectId } = options;
  const repoSyncOptions = { organizationId, projectId, sandbox };

  const allTools: Record<string, AnyTool> = {
    grep: tool({
      description: grepDescription,
      inputSchema: grepParameters,
      execute: async (args) => executeSandboxGrep(args, sandbox, cwd),
      toModelOutput: ({ output }) => truncateForModel(output, GREP_MAX_CHARS),
    }),
    glob: tool({
      description: globDescription,
      inputSchema: globParameters,
      execute: async (args) => executeSandboxGlob(args, sandbox, cwd),
      toModelOutput: ({ output }) => truncateForModel(output, GLOB_MAX_CHARS),
    }),
    read: tool({
      description: readDescription,
      inputSchema: readParameters,
      execute: async (args) => executeSandboxRead(args, sandbox, cwd),
    }),
    bash: tool({
      description: bashDescription,
      inputSchema: bashParameters,
      execute: async (args) => executeSandboxBash(args, sandbox, cwd),
    }),
    askUserQuestion: tool({
      description: askUserQuestionDescription,
      inputSchema: askUserQuestionParameters,
    }),
  };

  const filtered: Record<string, AnyTool> = {};
  for (const name of enabledTools) {
    if (allTools[name]) {
      filtered[name] = allTools[name];
    }
  }

  filtered.repoSync = tool({
    description: repoSyncDescription,
    inputSchema: repoSyncParameters,
    execute: async (args) => executeRepoSync(args, repoSyncOptions),
  });

  return filtered;
}
