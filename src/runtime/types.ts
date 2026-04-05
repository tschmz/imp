import type { AgentRunInput, AgentRunResult } from "./context.js";

export interface AgentRunner {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
