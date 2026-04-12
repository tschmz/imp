import { createAgentRegistry } from "../../agents/registry.js";
import type { AgentDefinition } from "../../domain/agent.js";
import type { ConversationContext } from "../../domain/conversation.js";
import type { IncomingMessage } from "../../domain/message.js";
import type { ConversationStore } from "../../storage/types.js";
import { inboundCommandHandlers } from "./registry.js";
import type { HandleIncomingMessageDependencies, InboundCommandContext } from "./types.js";

export function createIncomingMessage(
  command: IncomingMessage["command"],
  commandArgs?: string,
): IncomingMessage {
  return {
    endpointId: "private-telegram",
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
    prompt: {
      base: {
        text: "You are concise.",
      },
    },
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
      ensureActive: async (ref, options) => ({
        state: {
          conversation: {
            ...ref,
            sessionId: "session-1",
          },
          agentId: options.agentId,
          createdAt: options.now,
          updatedAt: options.now,
          version: 1,
        },
        messages: [],
      }),
      create: async (ref, options) => ({
        state: {
          conversation: {
            ...ref,
            sessionId: "session-1",
          },
          agentId: options.agentId,
          ...(options.title ? { title: options.title } : {}),
          createdAt: options.now,
          updatedAt: options.now,
          version: 1,
        },
        messages: [],
      }),
    },
    engine: {
      run: async () => ({
        message: {
          conversation: createIncomingMessage("help").conversation,
          text: "ok",
        },
        conversationEvents: [],
      }),
    },
    defaultAgentId: "default",
    runtimeInfo: {
      endpointId: "private-telegram",
      configPath: "/tmp/config.json",
      dataRoot: "/tmp/data",
      logFilePath: "/tmp/private-telegram.log",
      loggingLevel: "info",
      activeEndpointIds: ["private-telegram", "ops-telegram"],
    },
    availableCommands: inboundCommandHandlers,
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
  let counter = 0;

  return {
    get: async () => current,
    put: async (context) => {
      current = context;
    },
    listBackups: async () => [],
    restore: async () => false,
    ensureActive: async () => {
      if (!current) {
        throw new Error("no active conversation");
      }

      return current;
    },
    create: async (ref, options) => {
      counter += 1;
      current = {
        state: {
          conversation: {
            ...ref,
            sessionId: `session-${counter}`,
          },
          agentId: options.agentId,
          ...(options.title ? { title: options.title } : {}),
          createdAt: options.now,
          updatedAt: options.now,
          version: 1,
        },
        messages: [],
      } satisfies ConversationContext;
      return current;
    },
  };
}
