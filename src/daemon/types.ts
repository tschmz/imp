import type {
  AgentDelegationConfig,
  AgentMcpConfig,
  AgentPhoneCallConfig,
  AgentPromptConfig,
  AgentSkillsConfig,
  AgentWorkspaceConfig,
  ModelRef,
} from "../domain/agent.js";
import type { LogLevel, LogRotationSize } from "../logging/types.js";
import type { SkillDefinition } from "../skills/types.js";
import type { OutgoingMessageReplayItem } from "../domain/message.js";
import type { TransportType } from "../transports/registry.js";
import type { CommandToolRuntimeConfig } from "../runtime/command-tool.js";
import type { ToolDefinition } from "../tools/types.js";

interface BaseTransportRuntimeConfig {
  id: string;
  type: TransportType;
}

export interface TelegramEndpointRuntimeConfig extends BaseTransportRuntimeConfig {
  type: "telegram";
  token: string;
  allowedUserIds: string[];
  voice?: TelegramVoiceRuntimeConfig;
  document?: TelegramDocumentRuntimeConfig;
}

export interface CliEndpointRuntimeConfig extends BaseTransportRuntimeConfig {
  type: "cli";
  userId: string;
  initialAgentId?: string;
  initialReplay?: OutgoingMessageReplayItem[];
}

export interface FileEndpointRuntimeConfig extends BaseTransportRuntimeConfig {
  type: "file";
  pluginId: string;
  ingress: FileIngressRuntimeConfig;
  response: FileResponseRoutingRuntimeConfig;
}

export interface FileIngressRuntimeConfig {
  pollIntervalMs: number;
  maxEventBytes: number;
}

export type FileResponseRoutingRuntimeConfig =
  | { type: "none" }
  | {
      type: "endpoint";
      endpointId: string;
      target: {
        conversationId: string;
        userId?: string;
      };
    }
  | {
      type: "outbox";
      replyChannel: {
        kind: string;
      };
      priority?: "low" | "normal" | "high";
      ttlMs?: number;
      speech?: {
        enabled?: boolean;
        language?: string;
        model?: string;
        voice?: string;
        instructions?: string;
      };
    };

export interface TelegramVoiceRuntimeConfig {
  enabled: boolean;
  transcription: TelegramTranscriptionRuntimeConfig;
}

export interface TelegramTranscriptionRuntimeConfig {
  provider: "openai";
  model: string;
  language?: string;
}

export interface TelegramDocumentRuntimeConfig {
  maxDownloadBytes: number;
}

export type TransportEndpointRuntimeConfig =
  | TelegramEndpointRuntimeConfig
  | CliEndpointRuntimeConfig
  | FileEndpointRuntimeConfig;

export interface RuntimePaths {
  dataRoot: string;
  conversationsDir: string;
  logsDir: string;
  logFilePath: string;
  runtimeDir: string;
  runtimeStatePath: string;
  file?: FileEndpointRuntimePaths;
}

export interface FileEndpointRuntimePaths {
  rootDir: string;
  inboxDir: string;
  processingDir: string;
  processedDir: string;
  failedDir: string;
  outboxDir: string;
}

export type ActiveEndpointRuntimeConfig = TransportEndpointRuntimeConfig & {
  defaultAgentId: string;
  paths: RuntimePaths;
};

export interface DaemonConfig {
  configPath: string;
  logging: {
    level: LogLevel;
    rotationSize: LogRotationSize;
  };
  agents: ConfiguredAgent[];
  commandTools?: CommandToolRuntimeConfig[];
  pluginTools?: ToolDefinition[];
  activeEndpoints: ActiveEndpointRuntimeConfig[];
}

export interface Daemon {
  start(): Promise<void>;
}

export interface ConfiguredAgent {
  id: string;
  name?: string;
  prompt: AgentPromptConfig;
  model?: ModelRef;
  home?: string;
  workspace?: AgentWorkspaceConfig;
  skills?: AgentSkillsConfig;
  skillCatalog?: SkillDefinition[];
  skillIssues?: string[];
  tools?: string[];
  delegations?: AgentDelegationConfig[];
  mcp?: AgentMcpConfig;
  phone?: AgentPhoneCallConfig;
}
