import type { ConversationUserMessage } from "../../domain/conversation.js";
import type { IncomingMessage } from "../../domain/message.js";

export function toUserConversationMessage(message: IncomingMessage): ConversationUserMessage {
  return {
    kind: "message",
    id: message.messageId,
    role: "user",
    content: message.text,
    timestamp: Date.parse(message.receivedAt),
    createdAt: message.receivedAt,
    correlationId: message.correlationId,
    ...(message.source ? { source: message.source } : {}),
  };
}
