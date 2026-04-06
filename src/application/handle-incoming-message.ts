import type { AgentRegistry } from "../agents/registry.js";
import type { ConversationContext, ConversationState } from "../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import type { Logger } from "../logging/types.js";
import type { AgentEngine } from "../runtime/types.js";
import type { ConversationBackupSummary, ConversationStore } from "../storage/types.js";

interface HandleIncomingMessageDependencies {
  agentRegistry: AgentRegistry;
  conversationStore: ConversationStore;
  engine: AgentEngine;
  defaultAgentId: string;
  logger?: Logger;
}

export interface HandleIncomingMessage {
  handle(message: IncomingMessage): Promise<OutgoingMessage>;
}

export function createHandleIncomingMessage(
  dependencies: HandleIncomingMessageDependencies,
): HandleIncomingMessage {
  const defaultAgent = dependencies.agentRegistry.get(dependencies.defaultAgentId);

  if (!defaultAgent) {
    throw new Error(`Unknown default agent: ${dependencies.defaultAgentId}`);
  }

  return {
    async handle(message: IncomingMessage): Promise<OutgoingMessage> {
      if (message.command) {
        const commandResponse = await handleInboundCommand(
          message,
          defaultAgent.id,
          dependencies.conversationStore,
          dependencies.logger,
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
  defaultAgentId: string,
  conversationStore: ConversationStore,
  logger?: Logger,
): Promise<OutgoingMessage | undefined> {
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
        "/status Show the current conversation status.",
        "/history List restore points from previous /new resets.",
        "/restore <n> Restore backup number <n> from /history. 1 is the most recent backup.",
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
        `Agent: ${selectedBackup.agentId}`,
        `Messages: ${selectedBackup.messageCount}`,
        `Updated: ${selectedBackup.updatedAt}`,
      ].join("\n"),
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
      ? `Current: active with ${conversation.messages.length} messages, updated ${conversation.state.updatedAt}`
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
