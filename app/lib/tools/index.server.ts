import { tool, type Tool } from "ai";
import path from "node:path";
import { grepParameters, executeGrep } from "./grep.server";
import { globParameters, executeGlob } from "./glob.server";
import { readParameters, executeRead } from "./read.server";
import { bashParameters, executeBash } from "./bash.server";
import { askUserQuestionParameters, executeAskUserQuestion } from "./ask-user-question.server";

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
  conversationId: string;
  signal?: AbortSignal;
  enabledTools: string[];
}

type AnyTool = Tool<any, any>;

export function buildTools(options: BuildToolsOptions) {
  const { cwd, allowedDirs, conversationId, signal, enabledTools } = options;
  const toolOptions = { cwd, allowedDirs, signal };

  const allTools: Record<string, AnyTool> = {
    grep: tool({
      description: "Search file contents using regex patterns. Returns file paths with line numbers and matching content. Limited to 100 matches.",
      inputSchema: grepParameters,
      execute: async (args) => executeGrep(args, toolOptions),
    }),
    glob: tool({
      description: "Find files by name pattern (e.g., '**/*.ts', 'src/**/*.tsx'). Returns file paths sorted by modification time. Limited to 100 files.",
      inputSchema: globParameters,
      execute: async (args) => executeGlob(args, toolOptions),
    }),
    read: tool({
      description: "Read a specific file. Returns numbered lines. Use offset/limit for large files. Can read images and PDFs.",
      inputSchema: readParameters,
      execute: async (args) => executeRead(args, toolOptions),
    }),
    bash: tool({
      description: "Run shell commands (git log, git blame, find, wc, etc.). Always provide a description of what the command does.",
      inputSchema: bashParameters,
      execute: async (args) => executeBash(args, { cwd, signal }),
    }),
    askUserQuestion: tool({
      description: "Ask the user a clarifying question with predefined options. Use when you need the user to choose between alternatives or clarify their intent.",
      inputSchema: askUserQuestionParameters,
      execute: async (args) => executeAskUserQuestion(args, { conversationId }),
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
