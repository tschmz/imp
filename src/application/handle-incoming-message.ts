import type { AgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import { loadAppConfig } from "../config/load-app-config.js";
import type { ConversationContext, ConversationState } from "../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import type { LogLevel } from "../logging/types.js";
import type { Logger } from "../logging/types.js";
import { readRecentLogLines } from "../logging/view-logs.js";
import type { AgentEngine } from "../runtime/types.js";
import type { ConversationBackupSummary, ConversationStore } from "../storage/types.js";

interface RuntimeCommandInfo {
  botId: string;
  configPath: string;
  dataRoot: string;
  logFilePath: string;
  loggingLevel: LogLevel;
  activeBotIds: string[];
}

interface HandleIncomingMessageDependencies {
  agentRegistry: AgentRegistry;
  conversationStore: ConversationStore;
  engine: AgentEngine;
  defaultAgentId: string;
  runtimeInfo: RuntimeCommandInfo;
  loadAppConfig?: typeof loadAppConfig;
  readRecentLogLines?: typeof readRecentLogLines;
  logger?: Logger;
}

export interface HandleIncomingMessage {
  handle(message: IncomingMessage): Promise<OutgoingMessage>;
}

export function createHandleIncomingMessage(
  dependencies: HandleIncomingMessageDependencies,
): HandleIncomingMessage {
  const defaultAgent = dependencies.agentRegistry.get(dependencies.defaultAgentId);
  const loadAppConfigImpl = dependencies.loadAppConfig ?? loadAppConfig;
  const readRecentLogLinesImpl = dependencies.readRecentLogLines ?? readRecentLogLines;

  if (!defaultAgent) {
    throw new Error(`Unknown default agent: ${dependencies.defaultAgentId}`);
  }

  return {
    async handle(message: IncomingMessage): Promise<OutgoingMessage> {
      if (message.command) {
        const commandResponse = await handleInboundCommand(
          message,
          dependencies,
          dependencies.logger,
          loadAppConfigImpl,
          readRecentLogLinesImpl,
        );
        if (commandResponse) {
          return commandResponse;
        }
      }

      const conversation = await getOrCreateConversationContext(
        message,
        defaultAgent.id,
        dependencies.conversationStore,
        dependencies.logger,
      );
      const agent = dependencies.agentRegistry.get(conversation.state.agentId) ?? defaultAgent;
      await dependencies.logger?.debug("resolved conversation context", {
        botId: message.botId,
        transport: message.conversation.transport,
        conversationId: message.conversation.externalId,
        messageId: message.messageId,
        correlationId: message.correlationId,
        agentId: agent.id,
      });
      const response = await dependencies.engine.run({
        agent,
        conversation,
        message,
      });
      const respondedAt = new Date().toISOString();

      await dependencies.conversationStore.put({
        state: {
          ...conversation.state,
          ...(response.workingDirectory ? { workingDirectory: response.workingDirectory } : {}),
          updatedAt: respondedAt,
        },
        messages: [
          ...conversation.messages,
          toUserConversationMessage(message),
          toAssistantConversationMessage(
            response.message,
            message.messageId,
            respondedAt,
            message.correlationId,
          ),
        ],
      });

      return response.message;
    },
  };
}

async function handleInboundCommand(
  message: IncomingMessage,
  dependencies: HandleIncomingMessageDependencies,
  logger?: Logger,
  loadAppConfigImpl: typeof loadAppConfig = loadAppConfig,
  readRecentLogLinesImpl: typeof readRecentLogLines = readRecentLogLines,
): Promise<OutgoingMessage | undefined> {
  const { agentRegistry, conversationStore, defaultAgentId, runtimeInfo } = dependencies;

  if (message.command === "new") {
    await conversationStore.reset(message.conversation);
    await createConversationContext(message, defaultAgentId, conversationStore, logger);
    await logger?.debug("reset conversation via inbound command", {
      botId: message.botId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      command: message.command,
      agentId: defaultAgentId,
    });
    return {
      conversation: message.conversation,
      text: "Started a fresh conversation. The previous conversation was backed up.",
    };
  }

  if (message.command === "help") {
    return {
      conversation: message.conversation,
      text: [
        "Available commands:",
        "/help Show this help message.",
        "/new Start a fresh conversation and back up the current one.",
        "/clear Clear the active conversation without creating a backup.",
        "/status Show the current conversation status.",
        "/history List restore points from previous /new resets.",
        "/restore <n> Restore backup number <n> from /history. 1 is the most recent backup.",
        "/whoami Show your current bot, chat, and user IDs.",
        "/rename <title> Set a title for the current conversation.",
        "/export Export the current conversation transcript.",
        "/ping Check whether the bot is responsive.",
        "/config Show runtime and config details for this bot.",
        "/agent Show the current agent details, or switch with /agent <id>.",
        "/logs Show recent daemon log lines for this bot.",
        "/reload Exit after this reply so a supervisor can reload config.",
        "/restart Exit after this reply so a supervisor can restart the daemon.",
      ].join("\n"),
    };
  }

  if (message.command === "ping") {
    return {
      conversation: message.conversation,
      text: `pong\nBot: ${runtimeInfo.botId}\nTime: ${message.receivedAt}`,
    };
  }

  if (message.command === "whoami") {
    const conversation = await conversationStore.get(message.conversation);
    return {
      conversation: message.conversation,
      text: [
        "Identity:",
        `Bot: ${runtimeInfo.botId}`,
        `Transport: ${message.conversation.transport}`,
        `Chat ID: ${message.conversation.externalId}`,
        `User ID: ${message.userId}`,
        `Current agent: ${conversation?.state.agentId ?? defaultAgentId}`,
        `Title: ${conversation?.state.title ?? "not set"}`,
      ].join("\n"),
    };
  }

  if (message.command === "status") {
    const [conversation, backups] = await Promise.all([
      conversationStore.get(message.conversation),
      conversationStore.listBackups(message.conversation),
    ]);

    return {
      conversation: message.conversation,
      text: renderStatusMessage(conversation, backups),
    };
  }

  if (message.command === "rename") {
    const title = normalizeCommandArgument(message.commandArgs);
    if (!title) {
      return {
        conversation: message.conversation,
        text: "Usage: /rename <title>",
      };
    }

    const conversation = await getOrCreateConversationContext(
      message,
      defaultAgentId,
      conversationStore,
      logger,
    );
    await conversationStore.put({
      state: {
        ...conversation.state,
        title,
        updatedAt: message.receivedAt,
      },
      messages: conversation.messages,
    });
    return {
      conversation: message.conversation,
      text: `Renamed the current conversation to "${title}".`,
    };
  }

  if (message.command === "clear") {
    const existing = await conversationStore.get(message.conversation);
    if (!existing) {
      return {
        conversation: message.conversation,
        text: "There is no active conversation to clear.",
      };
    }

    await conversationStore.put({
      state: {
        conversation: existing.state.conversation,
        agentId: existing.state.agentId,
        ...(existing.state.title ? { title: existing.state.title } : {}),
        createdAt: message.receivedAt,
        updatedAt: message.receivedAt,
        version: existing.state.version,
      },
      messages: [],
    });
    return {
      conversation: message.conversation,
      text: "Cleared the active conversation. The current agent and title were preserved.",
    };
  }

  if (message.command === "history") {
    const [conversation, backups] = await Promise.all([
      conversationStore.get(message.conversation),
      conversationStore.listBackups(message.conversation),
    ]);

    return {
      conversation: message.conversation,
      text: renderHistoryMessage(conversation, backups),
    };
  }

  if (message.command === "restore") {
    const backups = await conversationStore.listBackups(message.conversation);
    const selectedBackup = pickRestoreBackup(backups, message.commandArgs);
    if (!selectedBackup) {
      return {
        conversation: message.conversation,
        text: renderRestoreUsage(backups.length),
      };
    }

    const restored = await conversationStore.restore(message.conversation, selectedBackup.id);
    if (!restored) {
      return {
        conversation: message.conversation,
        text: "That restore point is no longer available. Run /history and try again.",
      };
    }

    await logger?.debug("restored conversation via inbound command", {
      botId: message.botId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      command: message.command,
      backupId: selectedBackup.id,
      agentId: selectedBackup.agentId,
    });
    return {
      conversation: message.conversation,
      text: [
        `Restored backup ${backups.indexOf(selectedBackup) + 1}.`,
        "The previously active conversation was backed up before the restore.",
        `Agent: ${selectedBackup.agentId}`,
        `Messages: ${selectedBackup.messageCount}`,
        `Updated: ${selectedBackup.updatedAt}`,
      ].join("\n"),
    };
  }

  if (message.command === "export") {
    const conversation = await conversationStore.get(message.conversation);
    if (!conversation) {
      return {
        conversation: message.conversation,
        text: "There is no active conversation to export.",
      };
    }

    return {
      conversation: message.conversation,
      text: renderConversationExport(conversation),
    };
  }

  if (message.command === "config") {
    const appConfigSummary = await readAppConfigSummary(loadAppConfigImpl, runtimeInfo.configPath);

    return {
      conversation: message.conversation,
      text: [
        "Runtime config:",
        ...(appConfigSummary.instanceName ? [`Instance: ${appConfigSummary.instanceName}`] : []),
        `Config path: ${runtimeInfo.configPath}`,
        `Data root: ${runtimeInfo.dataRoot}`,
        `Logging level: ${runtimeInfo.loggingLevel}`,
        `Bot: ${runtimeInfo.botId}`,
        `Enabled bots: ${runtimeInfo.activeBotIds.join(", ")}`,
        `Default agent: ${defaultAgentId}`,
      ].join("\n"),
    };
  }

  if (message.command === "agent") {
    const requestedAgentId = normalizeCommandArgument(message.commandArgs);
    if (!requestedAgentId) {
      const conversation = await conversationStore.get(message.conversation);
      const activeAgent =
        agentRegistry.get(conversation?.state.agentId ?? defaultAgentId) ??
        agentRegistry.get(defaultAgentId)!;

      return {
        conversation: message.conversation,
        text: renderAgentMessage(activeAgent, {
          currentAgentId: activeAgent.id,
          availableAgentIds: agentRegistry.list().map((agent) => agent.id),
        }),
      };
    }

    const requestedAgent = agentRegistry.get(requestedAgentId);
    if (!requestedAgent) {
      return {
        conversation: message.conversation,
        text: [
          `Unknown agent: ${requestedAgentId}`,
          `Available: ${agentRegistry.list().map((agent) => agent.id).join(", ")}`,
        ].join("\n"),
      };
    }

    const conversation = await getOrCreateConversationContext(
      message,
      defaultAgentId,
      conversationStore,
      logger,
    );
    await conversationStore.put({
      state: {
        conversation: conversation.state.conversation,
        agentId: requestedAgent.id,
        ...(conversation.state.title ? { title: conversation.state.title } : {}),
        createdAt: conversation.state.createdAt,
        updatedAt: message.receivedAt,
        version: conversation.state.version,
      },
      messages: conversation.messages,
    });
    return {
      conversation: message.conversation,
      text: [
        `Switched the current conversation to agent "${requestedAgent.id}".`,
        "",
        renderAgentMessage(requestedAgent, {
          currentAgentId: requestedAgent.id,
          availableAgentIds: agentRegistry.list().map((agent) => agent.id),
        }),
      ].join("\n"),
    };
  }

  if (message.command === "logs") {
    const requestedLineCount = parsePositiveIntegerArgument(message.commandArgs);
    if (message.commandArgs && requestedLineCount === undefined) {
      return {
        conversation: message.conversation,
        text: "Usage: /logs [lines]",
      };
    }

    const lineCount = requestedLineCount ?? 20;
    try {
      const lines = await readRecentLogLinesImpl(runtimeInfo.logFilePath, lineCount);
      return {
        conversation: message.conversation,
        text:
          lines.length > 0
            ? [`Recent logs (${lines.length}):`, ...lines].join("\n")
            : "No log lines are available yet for this bot.",
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Log file not found:")) {
        return {
          conversation: message.conversation,
          text: "No log file is available yet for this bot.",
        };
      }

      throw error;
    }
  }

  if (message.command === "reload" || message.command === "restart") {
    return {
      conversation: message.conversation,
      text:
        message.command === "reload"
          ? [
              "Reload scheduled.",
              `The daemon will exit after this reply so a supervisor can restart it and reload ${runtimeInfo.configPath}.`,
              "If imp is not running under a service manager yet, start it again manually.",
            ].join("\n")
          : [
              "Restart scheduled.",
              "The daemon will exit after this reply so a supervisor can restart it.",
              "If imp is not running under a service manager yet, start it again manually.",
            ].join("\n"),
      deliveryAction: message.command,
    };
  }

  return undefined;
}

async function getOrCreateConversationContext(
  message: IncomingMessage,
  defaultAgentId: string,
  conversationStore: ConversationStore,
  logger?: Logger,
): Promise<ConversationContext> {
  const existing = await conversationStore.get(message.conversation);
  if (existing) {
    await logger?.debug("loaded existing conversation", {
      botId: message.botId,
      transport: message.conversation.transport,
      conversationId: message.conversation.externalId,
      messageId: message.messageId,
      correlationId: message.correlationId,
      agentId: existing.state.agentId,
    });
    return existing;
  }

  return createConversationContext(message, defaultAgentId, conversationStore, logger);
}

async function createConversationContext(
  message: IncomingMessage,
  defaultAgentId: string,
  conversationStore: ConversationStore,
  logger?: Logger,
): Promise<ConversationContext> {
  const createdState: ConversationState = {
    conversation: message.conversation,
    agentId: defaultAgentId,
    createdAt: message.receivedAt,
    updatedAt: message.receivedAt,
    version: 0,
  };

  const createdContext: ConversationContext = {
    state: createdState,
    messages: [],
  };

  await conversationStore.put(createdContext);
  await logger?.debug("created new conversation", {
    botId: message.botId,
    transport: message.conversation.transport,
    conversationId: message.conversation.externalId,
    messageId: message.messageId,
    correlationId: message.correlationId,
    agentId: defaultAgentId,
  });
  return {
    ...createdContext,
    state: {
      ...createdState,
      version: 1,
    },
  };
}

function toUserConversationMessage(message: IncomingMessage) {
  return {
    id: message.messageId,
    role: "user" as const,
    text: message.text,
    createdAt: message.receivedAt,
    correlationId: message.correlationId,
  };
}

function toAssistantConversationMessage(
  message: OutgoingMessage,
  parentMessageId: string,
  createdAt: string,
  correlationId: string,
) {
  return {
    id: `${parentMessageId}:assistant`,
    role: "assistant" as const,
    text: message.text,
    createdAt,
    correlationId,
  };
}

function renderStatusMessage(
  conversation: ConversationContext | undefined,
  backups: ConversationBackupSummary[],
): string {
  if (!conversation) {
    return [
      "No active conversation.",
      `Restore points available: ${backups.length}`,
      backups.length > 0 ? "Use /history to inspect them or /restore <n> to recover one." : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Current conversation:",
    `Title: ${conversation.state.title ?? "not set"}`,
    `Agent: ${conversation.state.agentId}`,
    `Messages: ${conversation.messages.length}`,
    `Created: ${conversation.state.createdAt}`,
    `Updated: ${conversation.state.updatedAt}`,
    `Working directory: ${conversation.state.workingDirectory ?? "not set"}`,
    `Restore points available: ${backups.length}`,
  ].join("\n");
}

function renderHistoryMessage(
  conversation: ConversationContext | undefined,
  backups: ConversationBackupSummary[],
): string {
  const lines = [
    "Conversation history:",
    conversation
      ? `Current: ${conversation.state.title ?? "untitled"} with ${conversation.messages.length} messages, updated ${conversation.state.updatedAt}`
      : "Current: no active conversation",
  ];

  if (backups.length === 0) {
    lines.push("Backups: none");
    return lines.join("\n");
  }

  lines.push("Backups:");
  for (const [index, backup] of backups.entries()) {
    lines.push(
      `${index + 1}. ${backup.updatedAt} | ${backup.messageCount} messages | agent ${backup.agentId}`,
    );
  }
  lines.push("Use /restore <n> to restore one of these backups.");
  return lines.join("\n");
}

function pickRestoreBackup(
  backups: ConversationBackupSummary[],
  commandArgs?: string,
): ConversationBackupSummary | undefined {
  if (!commandArgs) {
    return undefined;
  }

  const selectedIndex = Number.parseInt(commandArgs.trim(), 10);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 1) {
    return undefined;
  }

  return backups[selectedIndex - 1];
}

function renderRestoreUsage(backupCount: number): string {
  if (backupCount === 0) {
    return "No restore points are available yet. Use /new first, then /history to inspect backups.";
  }

  return [
    "Usage: /restore <n>",
    "Choose a numbered restore point from /history.",
    "Example: /restore 1",
  ].join("\n");
}

function normalizeCommandArgument(commandArgs?: string): string | undefined {
  const value = commandArgs?.trim();
  return value ? value : undefined;
}

function parsePositiveIntegerArgument(commandArgs?: string): number | undefined {
  const value = normalizeCommandArgument(commandArgs);
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

async function readAppConfigSummary(
  loadAppConfigImpl: typeof loadAppConfig,
  configPath: string,
): Promise<{ instanceName?: string }> {
  try {
    const appConfig = await loadAppConfigImpl(configPath);
    return {
      instanceName: appConfig.instance.name,
    };
  } catch {
    return {};
  }
}

function renderAgentMessage(
  agent: AgentDefinition,
  options: {
    currentAgentId: string;
    availableAgentIds: string[];
  },
): string {
  return [
    "Agent details:",
    `Current: ${options.currentAgentId}`,
    `Name: ${agent.name}`,
    `Provider: ${agent.model.provider}`,
    `Model: ${agent.model.modelId}`,
    `System prompt file: ${agent.systemPromptFile ?? "inline"}`,
    `Auth file: ${agent.authFile ?? "not set"}`,
    `Context files: ${agent.context?.files?.join(", ") ?? "none"}`,
    `Tools: ${agent.tools.length > 0 ? agent.tools.join(", ") : "none"}`,
    `Available: ${options.availableAgentIds.join(", ")}`,
  ].join("\n");
}

function renderConversationExport(conversation: ConversationContext): string {
  const lines = [
    "Conversation export",
    `Title: ${conversation.state.title ?? "untitled"}`,
    `Agent: ${conversation.state.agentId}`,
    `Created: ${conversation.state.createdAt}`,
    `Updated: ${conversation.state.updatedAt}`,
    "",
  ];

  if (conversation.messages.length === 0) {
    lines.push("No messages.");
    return lines.join("\n");
  }

  for (const message of conversation.messages) {
    lines.push(`[${message.createdAt}] ${message.role}`);
    lines.push(message.text);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
