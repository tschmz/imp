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

export interface AgentHandle {
  prompt(text: string): Promise<void>;
  state: {
    messages: AgentMessage[];
  };
}

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

interface AgentEventSubscriber {
  (event: AgentEvent, signal?: AbortSignal): void | Promise<void>;
}

interface EventSubscribableAgentHandle extends AgentHandle {
  subscribe?(subscriber: AgentEventSubscriber): () => void;
}

export function defaultCreateAgent(options: AgentOptions): AgentHandle {
  return new Agent(options);
}

export async function executeAgent(options: ExecuteAgentOptions): Promise<ExecuteAgentResult> {
  const createAgent = options.createAgent ?? defaultCreateAgent;
  const initialMessages = toAgentMessages(options.conversationMessages, options.model);

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

  const eventfulAgent = agent as EventSubscribableAgentHandle;
  const eventMessages = collectConversationEventMessages(eventfulAgent);

  try {
    await agent.prompt(options.userText);
  } finally {
    eventMessages.unsubscribe?.();
  }

  const appendedMessages = eventMessages.messages.length > 0
    ? eventMessages.messages
    : agent.state.messages.slice(initialMessages.length);

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
    conversationEvents: toConversationEvents(appendedMessages, {
      parentMessageId: options.parentMessageId,
      correlationId: options.correlationId,
    }),
    ...(options.workingDirectoryState.get() !== options.initialWorkingDirectory
      ? { workingDirectory: options.workingDirectoryState.get() }
      : {}),
  };
}

function collectConversationEventMessages(agent: EventSubscribableAgentHandle): {
  messages: AgentMessage[];
  unsubscribe?: () => void;
} {
  const messages: AgentMessage[] = [];
  const seen = new Set<string>();

  const recordMessage = (message: AgentMessage) => {
    if (message.role !== "assistant" && message.role !== "toolResult") {
      return;
    }

    const key = getAgentMessageKey(message);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    messages.push(message);
  };

  const unsubscribe = agent.subscribe?.((event) => {
    if (event.type === "turn_end") {
      recordMessage(event.message);
      for (const toolResult of event.toolResults) {
        recordMessage(toolResult);
      }
      return;
    }

    if (event.type === "message_end") {
      recordMessage(event.message);
    }
  });

  return { messages, unsubscribe };
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
