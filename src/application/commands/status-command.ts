import { renderStatusMessage } from "./renderers.js";
import { defaultResolveModel } from "../../runtime/model-resolution.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

export const statusCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "status",
    description: "Show the current session",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "status";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    const agentId =
      await dependencies.conversationStore.getSelectedAgent?.(message.conversation) ??
      dependencies.defaultAgentId;
    const conversation = await (dependencies.conversationStore.getActiveForAgent?.(agentId) ??
      dependencies.conversationStore.get(message.conversation));
    const agent = conversation ? dependencies.agentRegistry.get(conversation.state.agentId) : undefined;

    return {
      conversation: message.conversation,
      text: renderStatusMessage(conversation, agent, dependencies.resolveModel ?? defaultResolveModel),
    };
  },
};
