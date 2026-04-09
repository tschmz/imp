import type { AgentRunInput, AgentRunResult } from "./context.js";

export interface AgentEngine {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  close?(): Promise<void>;
}
