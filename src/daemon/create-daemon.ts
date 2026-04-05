import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { loadBuiltInAgents } from "../agents/definitions.js";
import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext, ConversationState } from "../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";
import { createFileLogger } from "../logging/file-logger.js";
import {
  createBuiltInToolRegistry,
  createPiAgentEngine,
  resolveAgentTools,
  resolveWorkingDirectory,
} from "../runtime/create-pi-agent-engine.js";
import type { AgentEngine } from "../runtime/types.js";
import { createFsConversationStore } from "../storage/fs-store.js";
import type { ConversationStore } from "../storage/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { createTelegramTransport } from "../transports/telegram/telegram-transport.js";
import type { Transport, TransportHandler } from "../transports/types.js";
import type { Daemon, DaemonConfig, RuntimePaths } from "./types.js";

interface RuntimeState {
  pid: number;
  botId: string;
  startedAt: string;
  configPath: string;
  logFilePath: string;
}

interface DaemonDependencies {
  agentRegistry?: ReturnType<typeof createAgentRegistry>;
  conversationStore?: ConversationStore;
  engine?: AgentEngine;
  toolRegistry?: ToolRegistry;
  createBuiltInToolRegistry?: (workingDirectory: string) => ToolRegistry;
  createTransport?: (config: DaemonConfig["activeBot"]) => Transport;
}

export function createDaemon(
  config: DaemonConfig,
  dependencies: DaemonDependencies = {},
): Daemon {
  const agentRegistry =
    dependencies.agentRegistry ?? createAgentRegistry(buildAgents(config.agents));
  const conversationStore = dependencies.conversationStore ?? createFsConversationStore(config.paths);
  const createBuiltInRegistry =
    dependencies.createBuiltInToolRegistry ?? createBuiltInToolRegistry;
  const engine =
    dependencies.engine ??
    createPiAgentEngine({
      ...(dependencies.toolRegistry ? { toolRegistry: dependencies.toolRegistry } : {}),
      createBuiltInToolRegistry: createBuiltInRegistry,
    });
  const createTransport = dependencies.createTransport ?? createTelegramTransport;
  const defaultAgent = agentRegistry.get(config.defaultAgentId);

  return {
    async start() {
      if (!defaultAgent) {
        throw new Error(`Unknown default agent: ${config.defaultAgentId}`);
      }
      validateAgentRegistry(agentRegistry, dependencies.toolRegistry, createBuiltInRegistry);

      await ensureRuntimePaths(config.paths);
      await ensureLogFile(config.paths.logFilePath);
      const logger = createFileLogger(config.paths.logFilePath);
      const runtimeStatePath = config.paths.runtimeStatePath;
      await assertNoRunningInstance(runtimeStatePath);
      await writeRuntimeState(runtimeStatePath, {
        pid: process.pid,
        botId: config.activeBot.id,
        startedAt: new Date().toISOString(),
        configPath: config.configPath,
        logFilePath: config.paths.logFilePath,
      });
      const cleanup = registerRuntimeCleanup({ runtimeStatePath });

      try {
        await logger.info(`starting daemon with default agent "${defaultAgent.id}"`);
        await logger.info(`data root: ${config.paths.dataRoot}`);
        await logger.info(`bot root: ${config.paths.botRoot}`);
        await logger.info(`conversations dir: ${config.paths.conversationsDir}`);
        await logger.info(`logs dir: ${config.paths.logsDir}`);
        await logger.info(`log file: ${config.paths.logFilePath}`);
        await logger.info(`runtime dir: ${config.paths.runtimeDir}`);
        await logger.info(`runtime file: ${runtimeStatePath}`);

        await logger.info(`active bot: ${config.activeBot.id}`);

        const transport = createTransport(config.activeBot);
        const handler: TransportHandler = {
          handle: async (message: IncomingMessage): Promise<OutgoingMessage> => {
            const conversation = await getOrCreateConversationContext(
              message,
              defaultAgent.id,
              conversationStore,
            );
            const agent = agentRegistry.get(conversation.state.agentId) ?? defaultAgent;
            const response = await engine.run({
              agent,
              conversation,
              message,
            });
            const respondedAt = new Date().toISOString();

            await conversationStore.put({
              state: {
                ...conversation.state,
                updatedAt: respondedAt,
              },
              messages: [
                ...conversation.messages,
                toUserConversationMessage(message),
                toAssistantConversationMessage(response.message, message.messageId, respondedAt),
              ],
            });

            return response.message;
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

function validateAgentRegistry(
  agentRegistry: ReturnType<typeof createAgentRegistry>,
  toolRegistry: ToolRegistry | undefined,
  createBuiltInRegistry: (workingDirectory: string) => ToolRegistry,
): void {
  for (const agent of agentRegistry.list()) {
    const registry = toolRegistry ?? createBuiltInRegistry(resolveWorkingDirectory(agent));
    resolveAgentTools(agent, registry);
  }
}

function buildAgents(configuredAgents: DaemonConfig["agents"]): AgentDefinition[] {
  const builtIns = loadBuiltInAgents();
  const builtInsById = new Map(builtIns.map((agent) => [agent.id, agent]));

  return configuredAgents.map((configuredAgent) => {
    const builtIn = builtInsById.get(configuredAgent.id);

    if (!builtIn) {
      if (!configuredAgent.systemPrompt) {
        throw new Error(
          `Configured agent "${configuredAgent.id}" must define systemPrompt.`,
        );
      }

      if (!configuredAgent.model) {
        throw new Error(`Configured agent "${configuredAgent.id}" must define model.`);
      }
    }

    return {
      id: configuredAgent.id,
      name: configuredAgent.name ?? builtIn?.name ?? configuredAgent.id,
      systemPrompt: configuredAgent.systemPrompt ?? builtIn?.systemPrompt ?? "",
      model: configuredAgent.model ?? builtIn?.model ?? { provider: "", modelId: "" },
      inference: configuredAgent.inference ?? builtIn?.inference,
      context: configuredAgent.context ?? builtIn?.context,
      tools: configuredAgent.tools ?? builtIn?.tools ?? [],
      extensions: builtIn?.extensions ?? [],
    };
  });
}

async function getOrCreateConversationContext(
  message: IncomingMessage,
  defaultAgentId: string,
  conversationStore: ConversationStore,
): Promise<ConversationContext> {
  const existing = await conversationStore.get(message.conversation);
  if (existing) {
    return existing;
  }

  const createdState: ConversationState = {
    conversation: message.conversation,
    agentId: defaultAgentId,
    createdAt: message.receivedAt,
    updatedAt: message.receivedAt,
  };

  const createdContext: ConversationContext = {
    state: createdState,
    messages: [],
  };

  await conversationStore.put(createdContext);
  return createdContext;
}

function toUserConversationMessage(message: IncomingMessage) {
  return {
    id: message.messageId,
    role: "user" as const,
    text: message.text,
    createdAt: message.receivedAt,
  };
}

function toAssistantConversationMessage(
  message: OutgoingMessage,
  parentMessageId: string,
  createdAt: string,
) {
  return {
    id: `${parentMessageId}:assistant`,
    role: "assistant" as const,
    text: message.text,
    createdAt,
  };
}

async function ensureRuntimePaths(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.dataRoot, { recursive: true });
  await mkdir(paths.botRoot, { recursive: true });
  await mkdir(paths.conversationsDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.runtimeDir, { recursive: true });
}

async function ensureLogFile(path: string): Promise<void> {
  await writeFile(path, "", { encoding: "utf8", flag: "a" });
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
    await removeRuntimeStateFile(path);
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

  await removeRuntimeStateFile(path);
}

function registerRuntimeCleanup(paths: { runtimeStatePath: string }): {
  dispose(): void;
  run(): Promise<void>;
} {
  let cleanedUp = false;

  const run = async (): Promise<void> => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    await removeRuntimeStateFile(paths.runtimeStatePath);
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

async function removeRuntimeStateFile(path: string): Promise<void> {
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
    value.configPath.length === 0 ||
    typeof value.logFilePath !== "string" ||
    value.logFilePath.length === 0
  ) {
    return null;
  }

  return {
    pid: value.pid,
    botId: value.botId,
    startedAt: value.startedAt,
    configPath: value.configPath,
    logFilePath: value.logFilePath,
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
