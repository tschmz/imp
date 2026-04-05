export interface InferenceSettings {
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
  request?: Record<string, unknown>;
}

export interface ModelRef {
  provider: string;
  modelId: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  systemPrompt: string;
  model: ModelRef;
  inference?: InferenceSettings;
  tools: string[];
  extensions: string[];
}
