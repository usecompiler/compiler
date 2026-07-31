import type { InferUITools, UIMessage } from "ai";
import type { AgentToolSet } from "~/lib/tools/index.server";

export type CompilerDataParts = {
  title: { title: string };
  heartbeat: null;
};

export type CompilerTools = InferUITools<AgentToolSet>;

export type CompilerUIMessage = UIMessage<unknown, CompilerDataParts, CompilerTools>;
