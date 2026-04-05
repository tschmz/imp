export interface InferenceSettings {
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
  request?: Record<string, unknown>;
}

export interface AgentContextConfig {
  files?: string[];
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
  context?: AgentContextConfig;
  tools: string[];
  extensions: string[];
}
