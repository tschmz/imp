export interface ModelRef {
  provider: string;
  modelId: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  systemPrompt: string;
  model: ModelRef;
  tools: string[];
  extensions: string[];
}
