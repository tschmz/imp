import type {
  Api as AiApi,
  AssistantMessage,
  Model,
  Usage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { ConversationMessage } from "../domain/conversation.js";

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

export function toAgentMessages(
  messages: ConversationMessage[],
  model: Model<AiApi>,
): Array<UserMessage | AssistantMessage> {
  return messages.reduce<Array<UserMessage | AssistantMessage>>((result, message) => {
    if (message.role === "user") {
      result.push({
        role: "user",
        content: message.text,
        timestamp: Date.parse(message.createdAt),
      });
      return result;
    }

    if (message.role === "assistant") {
      result.push({
        role: "assistant",
        content: [{ type: "text", text: message.text }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: EMPTY_USAGE,
        stopReason: "stop",
        timestamp: Date.parse(message.createdAt),
      });
    }

    return result;
  }, []);
}

export function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
}
