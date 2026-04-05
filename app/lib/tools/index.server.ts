import { tool, type Tool } from "ai";
import path from "node:path";
import { grepDescription, grepParameters, executeGrep } from "./grep.server";
import { globDescription, globParameters, executeGlob } from "./glob.server";
import { readDescription, readParameters, executeRead } from "./read.server";
import { bashDescription, bashParameters, executeBash } from "./bash.server";
import { askUserQuestionDescription, askUserQuestionParameters } from "./ask-user-question.server";
import { repoSyncDescription, repoSyncParameters, executeRepoSync } from "./repo-sync.server";

export const GREP_MAX_CHARS = 5000;
export const GLOB_MAX_CHARS = 5000;

export function truncateForModel(
  output: string,
  maxChars: number,
): { type: "text"; value: string } {
  if (output.length <= maxChars) {
    return { type: "text" as const, value: output };
  }
  const truncated = output.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf("\n");
  const clean = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
  const totalLines = output.split("\n").length;
  const shownLines = clean.split("\n").length;
  return {
    type: "text" as const,
    value: `${clean}\n\n[Truncated: showing ${shownLines} of ${totalLines} lines]`,
  };
}

export function validatePath(inputPath: string, allowedDirs: string[], cwd: string): string {
  const resolved = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(cwd, inputPath);

  const normalized = path.normalize(resolved);

  const isAllowed = allowedDirs.some(
    (dir) => normalized === dir || normalized.startsWith(dir + path.sep),
  );

  if (!isAllowed) {
    throw new Error(`Path "${inputPath}" is outside allowed directories`);
  }

  return normalized;
}

interface BuildToolsOptions {
  cwd: string;
  allowedDirs: string[];
  signal?: AbortSignal;
  enabledTools: string[];
  organizationId: string;
  projectId?: string | null;
}

type AnyTool = Tool<any, any>;

export function buildTools(options: BuildToolsOptions) {
  const { cwd, allowedDirs, signal, enabledTools, organizationId, projectId } = options;
  const toolOptions = { cwd, allowedDirs, signal };
  const repoSyncOptions = { organizationId, projectId };

  const allTools: Record<string, AnyTool> = {
    grep: tool({
      description: grepDescription,
      inputSchema: grepParameters,
      execute: async (args) => executeGrep(args, toolOptions),
      toModelOutput: ({ output }) => truncateForModel(output, GREP_MAX_CHARS),
    }),
    glob: tool({
      description: globDescription,
      inputSchema: globParameters,
      execute: async (args) => executeGlob(args, toolOptions),
      toModelOutput: ({ output }) => truncateForModel(output, GLOB_MAX_CHARS),
    }),
    read: tool({
      description: readDescription,
      inputSchema: readParameters,
      execute: async (args) => executeRead(args, toolOptions),
    }),
    bash: tool({
      description: bashDescription,
      inputSchema: bashParameters,
      execute: async (args) => executeBash(args, { cwd, signal }),
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
