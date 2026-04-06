import { readFile, stat } from "node:fs/promises";
import type { AgentOptions } from "@mariozechner/pi-agent-core";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { Logger } from "../logging/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentHandle } from "./agent-execution.js";
import { executeAgent } from "./agent-execution.js";
import { defaultResolveModel, resolveModelOrThrow, type ModelResolver } from "./model-resolution.js";
import { resolveSystemPrompt } from "./system-prompt-resolution.js";
import { InMemoryCacheStrategy, SystemPromptCache } from "./system-prompt-cache.js";
import type { AgentEngine } from "./types.js";
import {
  createBuiltInToolRegistry,
  createOnPayloadOverride,
  createWorkingDirectoryState,
  resolveAgentTools,
  resolveWorkingDirectory,
  type WorkingDirectoryState,
} from "./tool-resolution.js";

interface PiAgentEngineDependencies {
  logger?: Logger;
  resolveModel?: ModelResolver;
  getApiKey?: (
    provider: string,
    agent: AgentDefinition,
  ) => Promise<string | undefined> | string | undefined;
  createAgent?: (options: AgentOptions) => AgentHandle;
  readTextFile?: (path: string) => Promise<string>;
  getContextFileFingerprint?: (path: string) => Promise<string>;
  toolRegistry?: ToolRegistry;
  createBuiltInToolRegistry?: (
    workingDirectory: string | WorkingDirectoryState,
    agent?: AgentDefinition,
  ) => ToolRegistry;
}

interface EngineLogContext {
  botId: string;
  transport: string;
  conversationId: string;
  messageId: string;
  correlationId: string;
  agentId: string;
}

interface PipelineEvent {
  step: string;
  status: "started" | "completed" | "failed";
  durationMs?: number;
  cacheHit?: boolean;
  errorType?: string;
  error?: unknown;
}

export function createPiAgentEngine(
  dependencies: PiAgentEngineDependencies = {},
): AgentEngine {
  const resolveModel = dependencies.resolveModel ?? defaultResolveModel;
  const readTextFile = dependencies.readTextFile ?? defaultReadTextFile;
  const getContextFileFingerprint =
    dependencies.getContextFileFingerprint ?? defaultGetContextFileFingerprint;
  const buildToolRegistry =
    dependencies.createBuiltInToolRegistry ?? createBuiltInToolRegistry;
  const logger = dependencies.logger;
  const systemPromptCache = new SystemPromptCache({
    readTextFile,
    getContextFileFingerprint,
    strategy: new InMemoryCacheStrategy<string>(),
  });

  return {
    async run(input) {
      const startedAt = Date.now();
      const context: EngineLogContext = {
        botId: input.message.botId,
        transport: input.message.conversation.transport,
        conversationId: input.message.conversation.externalId,
        messageId: input.message.messageId,
        correlationId: input.message.correlationId,
        agentId: input.agent.id,
      };

      try {
        const initialWorkingDirectory = resolveConversationWorkingDirectory(
          input.agent,
          input.conversation,
        );
        const promptWorkingDirectory = resolvePromptWorkingDirectory(input.agent, input.conversation);
        const workingDirectoryState = createWorkingDirectoryState(initialWorkingDirectory);

        await logPipelineEvent(logger, context, { step: "model-resolution", status: "started" });
        const model = resolveModelOrThrow(input.agent, resolveModel);
        await logPipelineEvent(logger, context, { step: "model-resolution", status: "completed" });

        await logPipelineEvent(logger, context, { step: "system-prompt-resolution", status: "started" });
        const systemPromptResolution = await resolveSystemPrompt({
          agent: input.agent,
          promptWorkingDirectory,
          readTextFile,
          cache: systemPromptCache,
        });
        await logPipelineEvent(logger, context, {
          step: "system-prompt-resolution",
          status: "completed",
          cacheHit: systemPromptResolution.cacheHit,
        });

        await logPipelineEvent(logger, context, { step: "tool-resolution", status: "started" });
        const toolRegistry =
          dependencies.toolRegistry ??
          buildToolRegistry(workingDirectoryState, input.agent);
        const tools = resolveAgentTools(input.agent, toolRegistry);
        await logPipelineEvent(logger, context, { step: "tool-resolution", status: "completed" });

        await logPipelineEvent(logger, context, { step: "agent-execution", status: "started" });
        const result = await executeAgent({
          createAgent: dependencies.createAgent,
          getApiKey: dependencies.getApiKey,
          agent: input.agent,
          model,
          systemPrompt: systemPromptResolution.systemPrompt,
          tools,
          userText: input.message.text,
          conversationMessages: input.conversation.messages,
          onPayload: createOnPayloadOverride(input.agent),
          workingDirectoryState,
          initialWorkingDirectory,
          conversation: input.message.conversation,
        });
        await logPipelineEvent(logger, context, { step: "agent-execution", status: "completed" });

        await logPipelineEvent(logger, context, {
          step: "pipeline",
          status: "completed",
          durationMs: Date.now() - startedAt,
        });

        return result;
      } catch (error) {
        await logPipelineEvent(logger, context, {
          step: "pipeline",
          status: "failed",
          durationMs: Date.now() - startedAt,
          errorType: error instanceof Error ? error.name : typeof error,
          error,
        });
        throw error;
      }
    },
  };
}

async function logPipelineEvent(
  logger: Logger | undefined,
  context: EngineLogContext,
  event: PipelineEvent,
): Promise<void> {
  await logger?.debug("agent-engine.pipeline", {
    ...context,
    ...event,
  });

  if (event.status === "failed") {
    await logger?.error(
      "agent engine run failed",
      {
        ...context,
        durationMs: event.durationMs,
        errorType: event.errorType,
      },
      event.error instanceof Error ? event.error : new Error(String(event.error ?? "Unknown pipeline error")),
    );
  }
}

async function defaultReadTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function defaultGetContextFileFingerprint(path: string): Promise<string> {
  const fileStats = await stat(path);
  return `${fileStats.mtimeMs}:${fileStats.size}`;
}

function resolveConversationWorkingDirectory(
  agent: AgentDefinition,
  conversation: ConversationContext,
): string {
  return conversation.state.workingDirectory ?? resolveWorkingDirectory(agent);
}

function resolvePromptWorkingDirectory(
  agent: AgentDefinition,
  conversation: ConversationContext,
): string | undefined {
  return conversation.state.workingDirectory ?? agent.workspace?.cwd;
}

export {
  createBuiltInToolRegistry,
  mergeShellPathEntries,
  resolveAgentTools,
  resolveWorkingDirectory,
  type WorkingDirectoryState,
} from "./tool-resolution.js";
