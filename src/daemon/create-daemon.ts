import { loadBuiltInAgents } from "../agents/definitions.js";
import { createAgentRegistry } from "../agents/registry.js";
import type { ConversationState } from "../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import { createAgentRunner } from "../runtime/agent-runner.js";
import { createFsConversationStore } from "../storage/fs-store.js";
import { createTelegramTransport } from "../transports/telegram/telegram-transport.js";
import type { TransportHandler } from "../transports/types.js";
import type { Daemon, DaemonConfig } from "./types.js";

export function createDaemon(config: DaemonConfig): Daemon {
  const agentRegistry = createAgentRegistry(loadBuiltInAgents());
  const conversationStore = createFsConversationStore(config.dataDir);

  return {
    async start() {
      const defaultAgent = agentRegistry.get(config.defaultAgentId);
      if (!defaultAgent) {
        throw new Error(`Unknown default agent: ${config.defaultAgentId}`);
      }

      console.log(`starting daemon with default agent "${defaultAgent.id}"`);
      console.log(`data dir: ${config.dataDir}`);

      console.log(`active bot: ${config.activeBot.id}`);

      const transport = createTelegramTransport(config.activeBot);
      const handler: TransportHandler = {
        handle: async (message: IncomingMessage): Promise<OutgoingMessage> => {
          const conversation = await getOrCreateConversationState(
            message,
            defaultAgent.id,
            conversationStore,
          );
          const agent = agentRegistry.get(conversation.agentId) ?? defaultAgent;
          const runner = createAgentRunner(agent);
          const response = await runner.run(message);

          await conversationStore.put({
            ...conversation,
            updatedAt: message.receivedAt,
          });

          return response;
        },
      };

      await transport.start(handler);
    },
  };
}

async function getOrCreateConversationState(
  message: IncomingMessage,
  defaultAgentId: string,
  conversationStore: {
    get(ref: IncomingMessage["conversation"]): Promise<ConversationState | undefined>;
    put(state: ConversationState): Promise<void>;
  },
): Promise<ConversationState> {
  const existing = await conversationStore.get(message.conversation);
  if (existing) {
    return existing;
  }

  const created: ConversationState = {
    conversation: message.conversation,
    agentId: defaultAgentId,
    createdAt: message.receivedAt,
    updatedAt: message.receivedAt,
  };

  await conversationStore.put(created);
  return created;
}
