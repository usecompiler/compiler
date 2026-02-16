import { tool, type Tool } from "ai";
import path from "node:path";
import { grepDescription, grepParameters, executeGrep } from "./grep.server";
import { globDescription, globParameters, executeGlob } from "./glob.server";
import { readDescription, readParameters, executeRead } from "./read.server";
import { bashDescription, bashParameters, executeBash } from "./bash.server";
import { askUserQuestionDescription, askUserQuestionParameters } from "./ask-user-question.server";

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
}

type AnyTool = Tool<any, any>;

export function buildTools(options: BuildToolsOptions) {
  const { cwd, allowedDirs, signal, enabledTools } = options;
  const toolOptions = { cwd, allowedDirs, signal };

  const allTools: Record<string, AnyTool> = {
    grep: tool({
      description: grepDescription,
      inputSchema: grepParameters,
      execute: async (args) => executeGrep(args, toolOptions),
    }),
    glob: tool({
      description: globDescription,
      inputSchema: globParameters,
      execute: async (args) => executeGlob(args, toolOptions),
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

  return filtered;
}
