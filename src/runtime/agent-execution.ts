import { Agent, type AgentMessage, type AgentOptions } from "@mariozechner/pi-agent-core";
import type { Api as AiApi, AssistantMessage, Model } from "@mariozechner/pi-ai";
import type { AgentDefinition } from "../domain/agent.js";
import type { ToolDefinition } from "../tools/types.js";
import { getAssistantText, toAgentMessages } from "./message-mapping.js";
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
}

export interface ExecuteAgentResult {
  message: {
    conversation: {
      transport: string;
      externalId: string;
    };
    text: string;
  };
  workingDirectory?: string;
}

export function defaultCreateAgent(options: AgentOptions): AgentHandle {
  return new Agent(options);
}

export async function executeAgent(options: ExecuteAgentOptions): Promise<ExecuteAgentResult> {
  const createAgent = options.createAgent ?? defaultCreateAgent;

  const agent = createAgent({
    initialState: {
      systemPrompt: options.systemPrompt,
      model: options.model,
      thinkingLevel: "off",
      tools: options.tools,
      messages: toAgentMessages(options.conversationMessages, options.model),
    },
    ...(options.getApiKey
      ? {
          getApiKey: (provider: string) => options.getApiKey?.(provider, options.agent),
        }
      : {}),
    ...(options.onPayload ? { onPayload: options.onPayload } : {}),
  });

  await agent.prompt(options.userText);

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
    ...(options.workingDirectoryState.get() !== options.initialWorkingDirectory
      ? { workingDirectory: options.workingDirectoryState.get() }
      : {}),
  };
}
