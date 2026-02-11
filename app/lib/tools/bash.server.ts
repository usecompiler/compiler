import { z } from "zod";
import { execFile } from "node:child_process";

export const bashParameters = z.object({
  command: z.string().describe("The shell command to execute"),
  timeout: z.number().optional().describe("Timeout in milliseconds (default 120000)"),
  description: z.string().describe("Description of what this command does"),
});

const MAX_OUTPUT_CHARS = 30000;
const DEFAULT_TIMEOUT = 120000;

export async function executeBash(
  args: z.infer<typeof bashParameters>,
  options: { cwd: string; signal?: AbortSignal },
): Promise<string> {
  const timeout = args.timeout || DEFAULT_TIMEOUT;

  return new Promise((resolve) => {
    const proc = execFile(
      "bash",
      ["-c", args.command],
      {
        cwd: options.cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: process.env,
      },
      (error, stdout, stderr) => {
        let output = "";

        if (stdout) {
          output += stdout;
        }

        if (stderr) {
          if (output) output += "\n";
          output += `stderr: ${stderr}`;
        }

        if (error && !stdout && !stderr) {
          output = `Error: ${error.message}`;
        }

        if (output.length > MAX_OUTPUT_CHARS) {
          output = output.slice(0, MAX_OUTPUT_CHARS) + "\n[Output truncated]";
        }

        resolve(output || "(no output)");
      },
    );

    if (options.signal) {
      options.signal.addEventListener("abort", () => proc.kill(), { once: true });
    }
  });
}
