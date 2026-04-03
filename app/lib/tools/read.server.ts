import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { validatePath } from "./index.server";

export const readDescription = `Read a file from the local filesystem. Returns numbered lines (1-indexed).

- Use "offset" and "limit" parameters for large files
- Default limit is 2000 lines
- Lines longer than 2000 characters are truncated
- Can detect binary files, images, and PDFs
- The filePath parameter must be an absolute or relative path, not a glob pattern
- Multiple files can be read in parallel`;

export const readParameters = z.object({
  filePath: z.string().describe("Absolute or relative path to the file"),
  offset: z.number().optional().describe("Line number to start reading from (1-based)"),
  limit: z.number().optional().describe("Number of lines to read (default 2000)"),
});

export const MAX_OUTPUT_BYTES = 50 * 1024;
export const MAX_LINE_CHARS = 2000;
export const DEFAULT_LIMIT = 2000;

function isBinaryBuffer(buf: Buffer): boolean {
  const sampleSize = Math.min(buf.length, 8192);
  let nullCount = 0;
  let nonPrintable = 0;

  for (let i = 0; i < sampleSize; i++) {
    if (buf[i] === 0) nullCount++;
    if (buf[i] < 7 || (buf[i] > 14 && buf[i] < 32 && buf[i] !== 27)) nonPrintable++;
  }

  return nullCount > 0 || nonPrintable / sampleSize > 0.3;
}

export async function executeRead(
  args: z.infer<typeof readParameters>,
  options: { cwd: string; allowedDirs: string[]; signal?: AbortSignal },
): Promise<string> {
  const resolvedPath = validatePath(args.filePath, options.allowedDirs, options.cwd);

  const stat = await fs.stat(resolvedPath);
  if (stat.isDirectory()) {
    return `Error: ${resolvedPath} is a directory, not a file.`;
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const buf = await fs.readFile(resolvedPath);

  if (ext === ".pdf" || (buf.length > 4 && buf.slice(0, 5).toString() === "%PDF-")) {
    return `[PDF file: ${resolvedPath}, ${buf.length} bytes]\nBase64 content: ${buf.toString("base64").slice(0, 1000)}...`;
  }

  const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);
  if (imageExts.has(ext)) {
    return `[Image file: ${resolvedPath}, ${buf.length} bytes]`;
  }

  if (isBinaryBuffer(buf)) {
    return `[Binary file: ${resolvedPath}, ${buf.length} bytes]`;
  }

  const content = buf.toString("utf-8");
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
}
