import type { Api } from "@mariozechner/pi-ai";

export interface InferenceSettings {
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
  request?: Record<string, unknown>;
}

export interface PromptSource {
  text?: string;
  file?: string;
  builtIn?: "default";
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

export interface AgentSkillsConfig {
  paths: string[];
}

export interface AgentMcpServerConfig {
  id: string;
  command: string;
  args?: string[];
  inheritEnv?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface AgentMcpConfig {
  servers: AgentMcpServerConfig[];
}

export interface AgentPhoneContactConfig {
  id: string;
  name: string;
  uri: string;
  comment?: string;
}

export interface AgentPhoneCallConfig {
  contacts: AgentPhoneContactConfig[];
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  controlDir?: string;
}

export interface ModelRef {
  provider: string;
  modelId: string;
  api?: Api;
  baseUrl?: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
}

export interface AgentDefinition {
  id: string;
  name: string;
  prompt: AgentPromptConfig;
  model: ModelRef;
  home?: string;
  authFile?: string;
  inference?: InferenceSettings;
  workspace?: AgentWorkspaceConfig;
  skills?: AgentSkillsConfig;
  skillCatalog?: import("../skills/types.js").SkillDefinition[];
  skillIssues?: string[];
  tools: string[];
  mcp?: AgentMcpConfig;
  phone?: AgentPhoneCallConfig;
  extensions: string[];
}
