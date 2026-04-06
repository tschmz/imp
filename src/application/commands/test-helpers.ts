import { createAgentRegistry } from "../../agents/registry.js";
import type { AgentDefinition } from "../../domain/agent.js";
import type { IncomingMessage } from "../../domain/message.js";
import type { ConversationStore } from "../../storage/types.js";
import type { HandleIncomingMessageDependencies, InboundCommandContext } from "./types.js";

export function createIncomingMessage(
  command: IncomingMessage["command"],
  commandArgs?: string,
): IncomingMessage {
  return {
    botId: "private-telegram",
    conversation: {
      transport: "telegram",
      externalId: "42",
    },
    messageId: "msg-1",
    correlationId: "corr-1",
    userId: "7",
    text: `/${command}${commandArgs ? ` ${commandArgs}` : ""}`,
    receivedAt: "2026-04-05T00:00:00.000Z",
    command,
    ...(commandArgs ? { commandArgs } : {}),
  };
}

export function createDefaultAgent(id = "default"): AgentDefinition {
  return {
    id,
    name: id === "default" ? "Default" : id,
    systemPrompt: "You are concise.",
    model: {
      provider: "test",
      modelId: "stub",
    },
    tools: [],
    extensions: [],
  };
}

export function createDependencies(
  overrides: Partial<HandleIncomingMessageDependencies>,
): HandleIncomingMessageDependencies {
  return {
    agentRegistry: createAgentRegistry([createDefaultAgent(), createDefaultAgent("ops")]),
    conversationStore: {
      get: async () => undefined,
      put: async () => {},
      listBackups: async () => [],
      restore: async () => false,
      reset: async () => {},
    },
    engine: { run: async () => ({ message: { conversation: createIncomingMessage("help").conversation, text: "ok" } }) },
    defaultAgentId: "default",
    runtimeInfo: {
      botId: "private-telegram",
      configPath: "/tmp/config.json",
      dataRoot: "/tmp/data",
      logFilePath: "/tmp/private-telegram.log",
      loggingLevel: "info",
      activeBotIds: ["private-telegram", "ops-telegram"],
    },
    ...overrides,
  };
}

export function createCommandContext(
  overrides: Partial<InboundCommandContext> & Pick<InboundCommandContext, "message" | "dependencies">,
): InboundCommandContext {
  return {
    message: overrides.message,
    dependencies: overrides.dependencies,
    loadAppConfig: overrides.loadAppConfig ?? (async () => {
      throw new Error("not used");
    }),
    readRecentLogLines: overrides.readRecentLogLines ?? (async () => []),
    logger: overrides.logger,
  };
}

export function createMutableConversationStore(
  initial?: Awaited<ReturnType<ConversationStore["get"]>>,
): ConversationStore {
  let current = initial;

  return {
    get: async () => current,
    put: async (context) => {
      current = context;
    },
    listBackups: async () => [],
    restore: async () => false,
    reset: async () => {
      current = undefined;
    },
  };
}
