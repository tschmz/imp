import type { ConversationUserMessage } from "../../domain/conversation.js";
import type { IncomingMessage } from "../../domain/message.js";

export function toUserConversationMessage(message: IncomingMessage): ConversationUserMessage {
  return {
    id: message.messageId,
    role: "user",
    content: message.text,
    createdAt: message.receivedAt,
    correlationId: message.correlationId,
    ...(message.source ? { source: message.source } : {}),
  };
}
