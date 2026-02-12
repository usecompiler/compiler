import { z } from "zod";
import { spawn } from "node:child_process";
import { validatePath } from "./index.server";

export const grepDescription = `Search file contents using regex patterns built on ripgrep.

- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Use the "include" parameter to filter by file type (e.g., "*.ts", "*.py")
- Returns file paths with line numbers and matching content
- Limited to 100 matches
- Uses ripgrep syntax — literal braces need escaping (use \`interface\\{\\}\` to find \`interface{}\`)
- Patterns match within single lines by default`;

export const grepParameters = z.object({
  pattern: z.string().describe("Regex pattern to search for"),
  path: z.string().optional().describe("Directory to search in"),
  include: z.string().optional().describe("Glob pattern to filter files (e.g. '*.ts')"),
});

const MAX_MATCHES = 100;

export async function executeGrep(
  args: z.infer<typeof grepParameters>,
  options: { cwd: string; allowedDirs: string[]; signal?: AbortSignal },
): Promise<string> {
  const searchPath = args.path
    ? validatePath(args.path, options.allowedDirs, options.cwd)
    : options.cwd;

  const rgArgs = ["--json", "--max-count", String(MAX_MATCHES)];

  if (args.include) {
    rgArgs.push("--glob", args.include);
  }

  rgArgs.push(args.pattern, searchPath);

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
        resolve(stderr.trim() || "No matches found.");
        return;
      }

      const lines = stdout.trim().split("\n");
      const results: string[] = [];
      let count = 0;

      for (const line of lines) {
        if (count >= MAX_MATCHES) break;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "match") {
            const filePath = parsed.data?.path?.text || "";
            const lineNum = parsed.data?.line_number || 0;
            const text = parsed.data?.lines?.text?.trimEnd() || "";
            results.push(`${filePath}:${lineNum}: ${text}`);
            count++;
          }
        } catch {
          continue;
        }
      }

      resolve(results.join("\n") || "No matches found.");
    });
  });
}
