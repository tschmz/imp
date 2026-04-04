import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadBuiltInAgents } from "../agents/definitions.js";
import { createAgentRegistry } from "../agents/registry.js";
import type { ConversationState } from "../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import { createAgentRunner } from "../runtime/agent-runner.js";
import { createFsConversationStore } from "../storage/fs-store.js";
import { createTelegramTransport } from "../transports/telegram/telegram-transport.js";
import type { TransportHandler } from "../transports/types.js";
import type { Daemon, DaemonConfig, RuntimePaths } from "./types.js";

export function createDaemon(config: DaemonConfig): Daemon {
  const agentRegistry = createAgentRegistry(loadBuiltInAgents());
  const conversationStore = createFsConversationStore(config.paths);

  return {
    async start() {
      const defaultAgent = agentRegistry.get(config.defaultAgentId);
      if (!defaultAgent) {
        throw new Error(`Unknown default agent: ${config.defaultAgentId}`);
      }

      await ensureRuntimePaths(config.paths);
      const pidFilePath = join(config.paths.runtimeDir, "daemon.pid");
      await writePidFile(pidFilePath);
      const cleanup = registerRuntimeCleanup(pidFilePath);

      try {
        console.log(`starting daemon with default agent "${defaultAgent.id}"`);
        console.log(`data root: ${config.paths.dataRoot}`);
        console.log(`bot root: ${config.paths.botRoot}`);
        console.log(`conversations dir: ${config.paths.conversationsDir}`);
        console.log(`logs dir: ${config.paths.logsDir}`);
        console.log(`runtime dir: ${config.paths.runtimeDir}`);
        console.log(`pid file: ${pidFilePath}`);

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
      } finally {
        cleanup.dispose();
        await cleanup.run();
      }
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

async function ensureRuntimePaths(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.dataRoot, { recursive: true });
  await mkdir(paths.botRoot, { recursive: true });
  await mkdir(paths.conversationsDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.runtimeDir, { recursive: true });
}

async function writePidFile(path: string): Promise<void> {
  await writeFile(path, `${process.pid}\n`, "utf8");
}

function registerRuntimeCleanup(pidFilePath: string): {
  dispose(): void;
  run(): Promise<void>;
} {
  let cleanedUp = false;

  const run = async (): Promise<void> => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    await removePidFile(pidFilePath);
  };

  const handleSigint = () => {
    void run().finally(() => {
      process.exit(130);
    });
  };

  const handleSigterm = () => {
    void run().finally(() => {
      process.exit(143);
    });
  };

  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  return {
    dispose() {
      process.off("SIGINT", handleSigint);
      process.off("SIGTERM", handleSigterm);
    },
    run,
  };
}

async function removePidFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
