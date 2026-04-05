import { Agent } from "@mariozechner/pi-agent-core";
import {
  getModel,
  type Api as AiApi,
  type AssistantMessage,
  type Model,
  type Usage,
  type UserMessage,
} from "@mariozechner/pi-ai";
import type { ConversationMessage } from "../domain/conversation.js";
import type { AgentEngine } from "./types.js";

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

interface PiAgentEngineDependencies {
  resolveModel?: (provider: string, modelId: string) => Model<AiApi> | undefined;
}

export function createPiAgentEngine(
  dependencies: PiAgentEngineDependencies = {},
): AgentEngine {
  const resolveModel = dependencies.resolveModel ?? defaultResolveModel;

  return {
    async run(input) {
      const model = resolveModel(input.agent.model.provider, input.agent.model.modelId);
      if (!model) {
        throw new Error(
          `Unknown model for agent "${input.agent.id}": ` +
            `${input.agent.model.provider}/${input.agent.model.modelId}`,
        );
      }

      const agent = new Agent({
        initialState: {
          systemPrompt: input.agent.systemPrompt,
          model,
          thinkingLevel: "off",
          tools: [],
          messages: toAgentMessages(input.conversation.messages, model),
        },
      });

      await agent.prompt(input.message.text);

      const assistantMessage = [...agent.state.messages]
        .reverse()
        .find((message): message is AssistantMessage => message.role === "assistant");

      if (!assistantMessage) {
        throw new Error(`Agent "${input.agent.id}" did not produce an assistant message.`);
      }

      if (assistantMessage.stopReason === "error" || assistantMessage.stopReason === "aborted") {
        throw new Error(
          `Agent "${input.agent.id}" failed: ` +
            `${assistantMessage.errorMessage ?? "unknown upstream error"}`,
        );
      }

      const responseText = getAssistantText(assistantMessage);
      if (!responseText.trim()) {
        throw new Error(`Agent "${input.agent.id}" produced an assistant message without text content.`);
      }

      return {
        message: {
          conversation: input.message.conversation,
          text: responseText,
        },
      };
    },
  };
}

function defaultResolveModel(provider: string, modelId: string): Model<AiApi> | undefined {
  return getModel(provider as never, modelId as never);
}

function toAgentMessages(
  messages: ConversationMessage[],
  model: Model<AiApi>,
): Array<UserMessage | AssistantMessage> {
  return messages.reduce<Array<UserMessage | AssistantMessage>>((result, message) => {
    if (message.role === "user") {
      result.push(toUserMessage(message));
      return result;
    }

    if (message.role === "assistant") {
      result.push(toAssistantMessage(message, model));
      return result;
    }

    return result;
  }, []);
}

function toUserMessage(message: ConversationMessage): UserMessage {
  return {
    role: "user",
    content: message.text,
    timestamp: Date.parse(message.createdAt),
  };
}

function toAssistantMessage(message: ConversationMessage, model: Model<AiApi>): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: message.text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: "stop",
    timestamp: Date.parse(message.createdAt),
  };
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
}
