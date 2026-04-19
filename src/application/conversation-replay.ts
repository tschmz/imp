import type { ConversationContext, ConversationEvent } from "../domain/conversation.js";
import type { OutgoingMessageReplayItem } from "../domain/message.js";

export function toVisibleReplayItems(conversation: ConversationContext): OutgoingMessageReplayItem[] {
  return conversation.messages
    .map(toVisibleReplayItem)
    .filter((item): item is OutgoingMessageReplayItem => item !== undefined);
}

function toVisibleReplayItem(message: ConversationEvent): OutgoingMessageReplayItem | undefined {
  if (message.role === "toolResult") {
    return undefined;
  }

  if (message.role === "user") {
    const text = renderVisibleUserText(message.content);
    return text ? { role: "user", text, createdAt: message.createdAt } : undefined;
  }

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text ? { role: "assistant", text, createdAt: message.createdAt } : undefined;
}

function renderVisibleUserText(content: ConversationEvent["content"]): string {
  if (typeof content === "string") {
    return content.trim();
  }

  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}
