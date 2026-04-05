import type { AgentDefinition } from "../domain/agent.js";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "./default-system-prompt.js";

export function loadBuiltInAgents(): AgentDefinition[] {
  return [
    {
      id: "default",
      name: "Default",
      systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
      model: {
        provider: "openai",
        modelId: "gpt-5.4",
      },
      inference: {
        metadata: {
          app: "imp",
        },
        request: {
          store: true,
        },
      },
      tools: [],
      extensions: [],
    },
  ];
}
