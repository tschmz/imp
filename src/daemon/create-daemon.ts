import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
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

interface RuntimeState {
  pid: number;
  botId: string;
  startedAt: string;
  configPath: string;
}

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
      const runtimeStatePath = join(config.paths.runtimeDir, "daemon.json");
      await assertNoRunningInstance(runtimeStatePath);
      await writeRuntimeState(runtimeStatePath, {
        pid: process.pid,
        botId: config.activeBot.id,
        startedAt: new Date().toISOString(),
        configPath: config.configPath,
      });
      const cleanup = registerRuntimeCleanup(runtimeStatePath);

      try {
        console.log(`starting daemon with default agent "${defaultAgent.id}"`);
        console.log(`data root: ${config.paths.dataRoot}`);
        console.log(`bot root: ${config.paths.botRoot}`);
        console.log(`conversations dir: ${config.paths.conversationsDir}`);
        console.log(`logs dir: ${config.paths.logsDir}`);
        console.log(`runtime dir: ${config.paths.runtimeDir}`);
        console.log(`runtime file: ${runtimeStatePath}`);

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

async function writeRuntimeState(path: string, state: RuntimeState): Promise<void> {
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function assertNoRunningInstance(path: string): Promise<void> {
  const existingState = await readRuntimeState(path);
  if (existingState === undefined) {
    return;
  }

  if (existingState === null) {
    await removePidFile(path);
    return;
  }

  if (existingState.pid === process.pid) {
    return;
  }

  if (isProcessRunning(existingState.pid)) {
    throw new Error(
      `Another daemon instance is already running with pid ${existingState.pid}.`,
    );
  }

  await removePidFile(path);
}

function registerRuntimeCleanup(runtimeStatePath: string): {
  dispose(): void;
  run(): Promise<void>;
} {
  let cleanedUp = false;

  const run = async (): Promise<void> => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    await removePidFile(runtimeStatePath);
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

async function readRuntimeState(path: string): Promise<RuntimeState | null | undefined> {
  try {
    return parseRuntimeState(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

function parseRuntimeState(content: string): RuntimeState | null {
  let value: Partial<RuntimeState>;

  try {
    value = JSON.parse(content) as Partial<RuntimeState>;
  } catch {
    return null;
  }

  if (
    !Number.isInteger(value.pid) ||
    value.pid === undefined ||
    value.pid <= 0 ||
    typeof value.botId !== "string" ||
    value.botId.length === 0 ||
    typeof value.startedAt !== "string" ||
    value.startedAt.length === 0 ||
    typeof value.configPath !== "string" ||
    value.configPath.length === 0
  ) {
    return null;
  }

  return {
    pid: value.pid,
    botId: value.botId,
    startedAt: value.startedAt,
    configPath: value.configPath,
  };
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isMissingProcessError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isMissingProcessError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}
