import { readFile, stat } from "node:fs/promises";
import type { AgentOptions } from "@mariozechner/pi-agent-core";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { Logger } from "../logging/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentHandle } from "./agent-execution.js";
import { executeAgent } from "./agent-execution.js";
import { resolveMcpTools, type ResolvedMcpTools } from "./mcp-tool-runtime.js";
import { defaultResolveModel, resolveModelOrThrow, type ModelResolver } from "./model-resolution.js";
import {
  createDefaultPromptTemplateSystemContext,
  createPromptTemplateContext,
  type PromptTemplateSystemContext,
} from "./prompt-template.js";
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
  resolveMcpTools?: (
    agent: AgentDefinition,
    options: {
      logger?: Logger;
    },
  ) => Promise<ResolvedMcpTools>;
  promptTemplateSystemContext?: PromptTemplateSystemContext;
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

interface CachedMcpToolResolution {
  promise: Promise<ResolvedMcpTools>;
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
  const loadMcpTools = dependencies.resolveMcpTools ?? resolveMcpTools;
  const promptTemplateSystemContext =
    dependencies.promptTemplateSystemContext ?? createDefaultPromptTemplateSystemContext();
  const logger = dependencies.logger;
  const systemPromptCache = new SystemPromptCache({
    readTextFile,
    getContextFileFingerprint,
    strategy: new InMemoryCacheStrategy<string>(),
  });
  const mcpToolResolutionCache = new Map<string, CachedMcpToolResolution>();
  let closed = false;

  return {
    async run(input) {
      if (closed) {
        throw new Error("Agent engine is closed.");
      }

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
          templateContext: createPromptTemplateContext({
            system: promptTemplateSystemContext,
            agent: input.agent,
            botId: input.message.botId,
            transportKind: input.message.conversation.transport,
            configPath: input.runtime?.configPath,
            dataRoot: input.runtime?.dataRoot,
          }),
          activatedSkills: input.runtime?.activatedSkills,
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
        const builtInTools = resolveAgentTools(input.agent, toolRegistry);
        const mcpToolResolution = await getOrCreateMcpToolResolution(
          input.agent,
          logger,
          loadMcpTools,
          mcpToolResolutionCache,
        );
        const tools = [...builtInTools, ...mcpToolResolution.tools];
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
          parentMessageId: input.message.messageId,
          correlationId: input.message.correlationId,
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
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      const resolutions = [...mcpToolResolutionCache.values()];
      mcpToolResolutionCache.clear();

      if (resolutions.length === 0) {
        return;
      }

      await logger?.debug("closing cached MCP runtimes");

      await Promise.all(
        resolutions.map(async ({ promise }) => {
          const resolution = await promise;
          await resolution.close();
        }),
      );

      await logger?.debug("closed cached MCP runtimes");
    },
  };
}

async function getOrCreateMcpToolResolution(
  agent: AgentDefinition,
  logger: Logger | undefined,
  loadMcpTools: (
    agent: AgentDefinition,
    options: {
      logger?: Logger;
    },
  ) => Promise<ResolvedMcpTools>,
  cache: Map<string, CachedMcpToolResolution>,
): Promise<ResolvedMcpTools> {
  if (!agent.mcp || agent.mcp.servers.length === 0) {
    return {
      tools: [],
      async close() {},
    };
  }

  const cached = cache.get(agent.id);
  if (cached) {
    await logger?.debug(`reusing cached MCP runtime for agent "${agent.id}"`);
    return cached.promise;
  }

  await logger?.debug(`initializing cached MCP runtime for agent "${agent.id}"`);
  const promise = loadMcpTools(agent, { logger }).catch((error) => {
    cache.delete(agent.id);
    throw error;
  });
  cache.set(agent.id, { promise });

  const resolution = await promise;
  await logger?.debug(`cached MCP runtime ready for agent "${agent.id}"`);
  return resolution;
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
