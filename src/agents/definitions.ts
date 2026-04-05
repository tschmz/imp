import type { AgentDefinition } from "../domain/agent.js";

export function loadBuiltInAgents(): AgentDefinition[] {
  return [
    {
      id: "default",
      name: "Default",
      systemPrompt: "You are a concise and pragmatic assistant running through a local daemon.",
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
