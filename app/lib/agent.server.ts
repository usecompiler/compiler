import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import fs from "node:fs";

const REPOS_DIR = "/repos";

function findProjectDir(): string {
  // Look for the first subdirectory that contains a .git folder
  try {
    const entries = fs.readdirSync(REPOS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const projectPath = path.join(REPOS_DIR, entry.name);
        const gitPath = path.join(projectPath, ".git");
        if (fs.existsSync(gitPath)) {
          console.log("[agent] Using project dir:", projectPath);
          return projectPath;
        }
      }
    }
  } catch (err) {
    console.error("[agent] Error finding project dir:", err);
  }
  console.log("[agent] Falling back to REPOS_DIR:", REPOS_DIR);
  return REPOS_DIR;
}

const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Bash"];

const SYSTEM_PROMPT = `You are a friendly assistant that helps people understand software projects. Your audience is non-technical, so you must:

1. ALWAYS explain things in plain, simple English
2. NEVER show code snippets, file contents, or technical syntax
3. Describe what things DO, not how they're coded
4. Use everyday analogies when helpful
5. Summarize findings in terms of features and functionality
6. Avoid jargon - if you must use a technical term, explain it simply

CRITICAL - Project scope:
- Your current working directory IS the project you should explore
- ONLY explore files and folders in your current directory and its subdirectories
- NEVER use ".." or explore parent directories
- NEVER look outside the current directory tree
- Treat this as "the project"

When exploring projects:
- Describe what the project does and its purpose
- Explain features in terms of what users can do
- Describe the structure as "sections" or "parts" rather than files/folders
- Focus on the "what" and "why", not the "how"

IMPORTANT - Hide ALL implementation details:
- NEVER mention file names, file extensions, directories, folders, or file paths
- NEVER say things like "user.rb", "config.yml", "index.js" - describe the PURPOSE instead
- NEVER mention "repos", "repositories", or technical file structures
- Present everything as if you're exploring "the project" or "this software"
- Do not mention your tools, commands, or how you're finding information
- If asked for file names, explain that you describe functionality, not implementation details

CRITICAL - Never reveal libraries, packages, or dependencies:
- NEVER mention the names of gems, npm packages, pip packages, or any libraries/dependencies
- NEVER list or name third-party tools, frameworks, or packages (e.g., don't say "devise", "React", "stripe", "lodash")
- NEVER reveal what programming language, framework, or runtime the project uses
- Instead of naming libraries, describe WHAT CAPABILITY they provide (e.g., "user login system" not "devise gem")
- If asked directly for library/gem/package names, politely explain that you focus on describing what the software does, not its technical building blocks
- Even if you see a Gemfile, package.json, requirements.txt, or similar, NEVER reveal the package names inside

You have tools to explore behind the scenes, but the user should only see friendly, plain-language explanations about what the software does - never the technical implementation details.`;

export interface AgentStats {
  toolUses: number;
  tokens: number;
  durationMs: number;
}

export interface AgentEvent {
  type: "text" | "tool_use" | "tool_result" | "new_turn" | "result" | "error" | "done";
  content?: string;
  tool?: string;
  input?: unknown;
  stats?: AgentStats;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

function formatHistory(messages: HistoryMessage[]): string {
  if (messages.length === 0) return "";

  const formatted = messages
    .map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  return `Previous conversation:\n${formatted}\n\n`;
}

export async function* runAgent(
  prompt: string,
  history: HistoryMessage[] = []
): AsyncGenerator<AgentEvent> {
  const fullPrompt = formatHistory(history) + `Human: ${prompt}`;

  try {
    let turnCount = 0;
    let toolUseCount = 0;

    for await (const message of query({
      prompt: fullPrompt,
      options: {
        systemPrompt: SYSTEM_PROMPT,
        allowedTools: ALLOWED_TOOLS,
        permissionMode: "plan",
        cwd: findProjectDir(),
        additionalDirectories: ["/repos"],
        env: {
          ...process.env,
          SHELL: "/bin/bash",
        },
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        turnCount++;
        // Emit marker between assistant turns for paragraph breaks
        if (turnCount > 1) {
          yield { type: "new_turn" };
        }
        for (const block of message.message.content) {
          if ("text" in block && block.text) {
            yield { type: "text", content: block.text };
          } else if ("type" in block && block.type === "tool_use") {
            toolUseCount++;
            yield {
              type: "tool_use",
              tool: (block as { name?: string }).name,
              input: (block as { input?: unknown }).input,
            };
          }
        }
      } else if (message.type === "result") {
        // Emit final stats
        const usage = (message as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        const tokens = (usage?.input_tokens || 0) + (usage?.output_tokens || 0);
        const durationMs = (message as { duration_ms?: number }).duration_ms || 0;
        yield {
          type: "result",
          stats: {
            toolUses: toolUseCount,
            tokens,
            durationMs,
          },
        };
      } else if (message.type === "user" && message.message?.content) {
        for (const block of message.message.content) {
          if (
            "type" in block &&
            block.type === "tool_result" &&
            "content" in block
          ) {
            const content = block.content;
            const text =
              typeof content === "string"
                ? content
                : Array.isArray(content)
                  ? content
                      .filter(
                        (c): c is { type: "text"; text: string } =>
                          typeof c === "object" && "text" in c
                      )
                      .map((c) => c.text)
                      .join("\n")
                  : "";
            yield {
              type: "tool_result",
              content: text.slice(0, 500) + (text.length > 500 ? "..." : ""),
            };
          }
        }
      }
    }

    yield { type: "done" };
  } catch (error) {
    yield {
      type: "error",
      content: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
