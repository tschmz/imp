export interface InferenceSettings {
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
  request?: Record<string, unknown>;
}

export interface AgentContextConfig {
  files?: string[];
  workingDirectory?: string;
}

export interface ModelRef {
  provider: string;
  modelId: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  systemPrompt: string;
  systemPromptFile?: string;
  model: ModelRef;
  authFile?: string;
  inference?: InferenceSettings;
  context?: AgentContextConfig;
  tools: string[];
  extensions: string[];
}
