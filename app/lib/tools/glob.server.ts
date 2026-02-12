import { z } from "zod";
import { spawn } from "node:child_process";
import { validatePath } from "./index.server";

export const globDescription = `Fast file pattern matching tool that works with any codebase size.

- Supports glob patterns like "**/*.ts" or "src/**/*.tsx"
- Returns matching file paths
- Limited to 100 files
- Use this first to understand project structure before diving into specific files
- Multiple searches can be performed in parallel`;

export const globParameters = z.object({
  pattern: z.string().describe("Glob pattern to match files (e.g. '**/*.ts')"),
  path: z.string().optional().describe("Directory to search in"),
});

const MAX_FILES = 100;

export async function executeGlob(
  args: z.infer<typeof globParameters>,
  options: { cwd: string; allowedDirs: string[]; signal?: AbortSignal },
): Promise<string> {
  const searchPath = args.path
    ? validatePath(args.path, options.allowedDirs, options.cwd)
    : options.cwd;

  const rgArgs = ["--files", "--glob", args.pattern, searchPath];

  return new Promise((resolve) => {
    const proc = spawn("rg", rgArgs, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.on("error", (err) => {
      resolve(`Error: ${err.message}`);
    });

    if (options.signal) {
      options.signal.addEventListener("abort", () => proc.kill(), { once: true });
    }

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", () => {
      if (!stdout.trim()) {
        resolve(stderr.trim() || "No files found.");
        return;
      }

      const files = stdout.trim().split("\n").slice(0, MAX_FILES);
      resolve(files.join("\n"));
    });
  });
}
