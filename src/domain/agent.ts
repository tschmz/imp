export interface InferenceSettings {
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
  request?: Record<string, unknown>;
}

export interface PromptSource {
  text?: string;
  file?: string;
}

export interface AgentPromptConfig {
  base: PromptSource;
  instructions?: PromptSource[];
  references?: PromptSource[];
}

export interface AgentWorkspaceConfig {
  cwd?: string;
  shellPath?: string[];
}

export interface ModelRef {
  provider: string;
  modelId: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  prompt: AgentPromptConfig;
  model: ModelRef;
  authFile?: string;
  inference?: InferenceSettings;
  workspace?: AgentWorkspaceConfig;
  tools: string[];
  extensions: string[];
}
