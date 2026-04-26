import type { Api as AiApi, Model } from "@mariozechner/pi-ai";
import type { ConversationAssistantMessage, ConversationEvent } from "../domain/conversation.js";

interface PreviousResponseState {
  previousResponseId?: string;
  conversationMessages: ConversationEvent[];
}

export function resolvePreviousResponseState(
  messages: ConversationEvent[],
  model: Pick<Model<AiApi>, "api" | "provider">,
): PreviousResponseState {
  if (!supportsPreviousResponseId(model.api)) {
    return { conversationMessages: messages };
  }

  const latestAssistant = findLatestAssistantMessage(messages);
  if (
    !latestAssistant ||
    latestAssistant.api !== model.api ||
    latestAssistant.provider !== model.provider ||
    !latestAssistant.responseId ||
    latestAssistant.stopReason === "error" ||
    latestAssistant.stopReason === "aborted"
  ) {
    return { conversationMessages: messages };
  }

  const assistantIndex = messages.lastIndexOf(latestAssistant);

  return {
    previousResponseId: latestAssistant.responseId,
    conversationMessages: messages.slice(assistantIndex + 1),
  };
}

export function supportsPreviousResponseId(api: AiApi): boolean {
  return api === "openai-responses" || api === "azure-openai-responses" || api === "openai-codex-responses";
}

function findLatestAssistantMessage(
  messages: ConversationEvent[],
): ConversationAssistantMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return message;
    }
  }

  return undefined;
}
