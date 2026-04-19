import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentOptions,
} from "@mariozechner/pi-agent-core";
import type { Api as AiApi, AssistantMessage, Model } from "@mariozechner/pi-ai";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationEvent } from "../domain/conversation.js";
import type { ToolDefinition } from "../tools/types.js";
import { getAssistantText, toAgentMessages, toConversationEvents } from "./message-mapping.js";
import type { WorkingDirectoryState } from "./tool-resolution.js";

export type AgentHandle =
  Pick<Agent, "prompt">
  & {
    state: Pick<Agent["state"], "messages">;
  }
  & Partial<Pick<Agent, "continue" | "subscribe">>;

type ConversationMessageEvent = Extract<AgentEvent, { type: "message_end" }>;

export interface ExecuteAgentOptions {
  createAgent?: (options: AgentOptions) => AgentHandle;
  getApiKey?: (
    provider: string,
    agent: AgentDefinition,
  ) => Promise<string | undefined> | string | undefined;
  agent: AgentDefinition;
  model: Model<AiApi>;
  systemPrompt: string;
  tools: ToolDefinition[];
  userText: string;
  conversationMessages: Parameters<typeof toAgentMessages>[0];
  onPayload: AgentOptions["onPayload"];
  workingDirectoryState: WorkingDirectoryState;
  initialWorkingDirectory: string;
  conversation: {
    transport: string;
    externalId: string;
  };
  parentMessageId: string;
  correlationId: string;
  onConversationEvents?: (events: ConversationEvent[]) => Promise<void> | void;
  continueFromContext?: boolean;
}

export interface ExecuteAgentResult {
  message: {
    conversation: {
      transport: string;
      externalId: string;
    };
    text: string;
  };
  conversationEvents: ConversationEvent[];
  workingDirectory?: string;
}

export function defaultCreateAgent(options: AgentOptions): AgentHandle {
  return new Agent(options);
}

export async function executeAgent(options: ExecuteAgentOptions): Promise<ExecuteAgentResult> {
  const createAgent = options.createAgent ?? defaultCreateAgent;
  const initialMessages = toAgentMessages(options.conversationMessages, options.model);
  const initialTurnIndexes = countExistingTurnEvents(options.conversationMessages, options.parentMessageId);

  const agent = createAgent({
    initialState: {
      systemPrompt: options.systemPrompt,
      model: options.model,
      thinkingLevel: "off",
      tools: options.tools,
      messages: initialMessages,
    },
    ...(options.getApiKey
      ? {
          getApiKey: (provider: string) => options.getApiKey?.(provider, options.agent),
        }
      : {}),
    ...(options.onPayload ? { onPayload: options.onPayload } : {}),
  });

  const eventMessages = collectConversationEventMessages(agent, {
    parentMessageId: options.parentMessageId,
    correlationId: options.correlationId,
    initialAssistantIndex: initialTurnIndexes.assistant,
    initialToolResultIndex: initialTurnIndexes.toolResult,
    onConversationEvents: options.onConversationEvents,
  });

  try {
    if (options.continueFromContext) {
      if (!agent.continue) {
        throw new Error(`Agent "${options.agent.id}" cannot continue from persisted context.`);
      }
      await agent.continue();
    } else {
      await agent.prompt(options.userText);
    }
  } finally {
    eventMessages.unsubscribe?.();
  }

  const appendedMessages = eventMessages.messages.length > 0
    ? eventMessages.messages
    : agent.state.messages.slice(initialMessages.length);
  const conversationEvents = eventMessages.events.length > 0
    ? eventMessages.events
    : toConversationEvents(appendedMessages, {
        parentMessageId: options.parentMessageId,
        correlationId: options.correlationId,
        initialAssistantIndex: initialTurnIndexes.assistant,
        initialToolResultIndex: initialTurnIndexes.toolResult,
      });

  const assistantMessage = [...agent.state.messages]
    .reverse()
    .find((message): message is AssistantMessage => message.role === "assistant");

  if (!assistantMessage) {
    throw new Error(`Agent "${options.agent.id}" did not produce an assistant message.`);
  }

  if (assistantMessage.stopReason === "error" || assistantMessage.stopReason === "aborted") {
    throw new Error(
      `Agent "${options.agent.id}" failed: ` +
        `${assistantMessage.errorMessage ?? "unknown upstream error"}`,
    );
  }

  const responseText = getAssistantText(assistantMessage);
  if (!responseText.trim()) {
    throw new Error(`Agent "${options.agent.id}" produced an assistant message without text content.`);
  }

  return {
    message: {
      conversation: options.conversation,
      text: responseText,
    },
    conversationEvents,
    ...(options.workingDirectoryState.get() !== options.initialWorkingDirectory
      ? { workingDirectory: options.workingDirectoryState.get() }
      : {}),
  };
}

function collectConversationEventMessages(
  agent: AgentHandle,
  options: {
    parentMessageId: string;
    correlationId: string;
    initialAssistantIndex: number;
    initialToolResultIndex: number;
    onConversationEvents?: (events: ConversationEvent[]) => Promise<void> | void;
  },
): {
  messages: AgentMessage[];
  events: ConversationEvent[];
  unsubscribe?: () => void;
} {
  const messages: AgentMessage[] = [];
  const events: ConversationEvent[] = [];
  const seen = new Set<string>();

  const recordMessage = async (message: AgentMessage) => {
    if (message.role !== "assistant" && message.role !== "toolResult") {
      return;
    }

    const key = getAgentMessageKey(message);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    messages.push(message);
    const nextEvents = toConversationEvents(messages, {
      parentMessageId: options.parentMessageId,
      correlationId: options.correlationId,
      initialAssistantIndex: options.initialAssistantIndex,
      initialToolResultIndex: options.initialToolResultIndex,
    }).slice(events.length);
    events.push(...nextEvents);

    if (nextEvents.length > 0) {
      await options.onConversationEvents?.(nextEvents);
    }
  };

  const unsubscribe = agent.subscribe?.(async (event) => {
    if (isConversationMessageEvent(event)) {
      await recordMessage(event.message);
    }
  });

  return { messages, events, unsubscribe };
}

function countExistingTurnEvents(
  messages: ConversationEvent[],
  parentMessageId: string,
): { assistant: number; toolResult: number } {
  let assistant = 0;
  let toolResult = 0;

  for (const message of messages) {
    if (message.role === "assistant" && message.id.startsWith(`${parentMessageId}:assistant:`)) {
      assistant += 1;
    }
    if (message.role === "toolResult" && message.id.startsWith(`${parentMessageId}:tool-result:`)) {
      toolResult += 1;
    }
  }

  return { assistant, toolResult };
}

function isConversationMessageEvent(event: AgentEvent): event is ConversationMessageEvent {
  return event.type === "message_end";
}

function getAgentMessageKey(message: Extract<AgentMessage, { role: "assistant" | "toolResult" }>): string {
  if (message.role === "toolResult") {
    return JSON.stringify([
      message.role,
      message.timestamp,
      message.toolCallId,
      message.toolName,
      message.isError,
      message.content,
      message.details ?? null,
    ]);
  }

  return JSON.stringify([
    message.role,
    message.timestamp,
    message.responseId ?? null,
    message.provider,
    message.model,
    message.stopReason,
    message.errorMessage ?? null,
    message.content,
  ]);
}
