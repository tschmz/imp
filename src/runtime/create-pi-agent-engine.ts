import { readFile, stat } from "node:fs/promises";
import type { AgentOptions } from "@mariozechner/pi-agent-core";
import type { AgentDefinition } from "../domain/agent.js";
import type { Logger } from "../logging/types.js";
import { createHookRunner } from "../plugins/hook-runner.js";
import type { AgentEngineLifecycleHooks, HookRegistration } from "../plugins/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentHandle } from "./agent-execution.js";
import { createMcpToolCache } from "./mcp-tool-cache.js";
import { resolveMcpTools, type ResolvedMcpTools } from "./mcp-tool-runtime.js";
import { defaultResolveModel, type ModelResolver } from "./model-resolution.js";
import {
  createDefaultPromptTemplateSystemContext,
  type PromptTemplateSystemContext,
} from "./prompt-template.js";
import { executeAgentStage } from "./pipeline/execute-agent-stage.js";
import { resolveModelStage } from "./pipeline/resolve-model-stage.js";
import { resolvePromptStage } from "./pipeline/resolve-prompt-stage.js";
import { resolveToolsStage } from "./pipeline/resolve-tools-stage.js";
import { InMemoryCacheStrategy, SystemPromptCache } from "./system-prompt-cache.js";
import type { SystemPromptResolutionResult } from "./system-prompt-resolution.js";
import type { AgentEngine, AgentRunContext } from "./types.js";
import {
  createBuiltInToolRegistry,
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
  agentEngineHooks?: ReadonlyArray<HookRegistration<AgentEngineLifecycleHooks>>;
}

interface EngineLogContext {
  endpointId: string;
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
  initialWorkingDirectory?: string;
  configuredBuiltInTools?: string[];
  resolvedBuiltInTools?: string[];
  missingBuiltInTools?: string[];
  configuredMcpServers?: string[];
  initializedMcpServers?: string[];
  failedMcpServers?: string[];
  resolvedMcpTools?: string[];
  resolvedTools?: string[];
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
  const mcpToolCache = createMcpToolCache({
    logger,
    resolveMcpTools: loadMcpTools,
  });
  const hookRunner = createHookRunner(dependencies.agentEngineHooks, { logger });
  let closed = false;

  return {
    async run(input) {
      if (closed) {
        throw new Error("Agent engine is closed.");
      }

      const context: EngineLogContext = {
        endpointId: input.message.endpointId,
        transport: input.message.conversation.transport,
        conversationId: input.message.conversation.externalId,
        messageId: input.message.messageId,
        correlationId: input.message.correlationId,
        agentId: input.agent.id,
      };
      const startedAt = Date.now();

      try {
        await hookRunner.run(
          "onAgentEngineRunStart",
          (hooks) => hooks.onAgentEngineRunStart,
          { input },
        );

        const runContext: AgentRunContext = {
          input,
          agent: input.agent,
          conversation: input.conversation,
        };

        await logPipelineEvent(logger, context, { step: "model-resolution", status: "started" });
        const modelContext = resolveModelStage(runContext, { resolveModel });
        await logPipelineEvent(logger, context, { step: "model-resolution", status: "completed" });

        await logPipelineEvent(logger, context, { step: "system-prompt-resolution", status: "started" });
        const promptContext = await resolvePromptStage(modelContext, {
          readTextFile,
          systemPromptCache,
          promptTemplateSystemContext,
        });
        await logPipelineEvent(logger, context, {
          step: "system-prompt-resolution",
          status: "completed",
          cacheHit: promptContext.systemPromptResolution.cacheHit,
        });
        await logSystemPromptSources(logger, context, promptContext.systemPromptResolution);

        await logPipelineEvent(logger, context, { step: "tool-resolution", status: "started" });
        const toolContext = await resolveToolsStage(promptContext, {
          toolRegistry: dependencies.toolRegistry,
          createBuiltInToolRegistry: buildToolRegistry,
          mcpToolCache,
        });
        await logPipelineEvent(logger, context, {
          step: "tool-resolution",
          status: "completed",
          initialWorkingDirectory: toolContext.initialWorkingDirectory,
          configuredBuiltInTools: toolContext.toolResolution.configuredBuiltInTools,
          resolvedBuiltInTools: toolContext.toolResolution.resolvedBuiltInTools,
          missingBuiltInTools: toolContext.toolResolution.missingBuiltInTools,
          configuredMcpServers: toolContext.toolResolution.configuredMcpServers,
          initializedMcpServers: toolContext.toolResolution.initializedMcpServers,
          failedMcpServers: toolContext.toolResolution.failedMcpServers,
          resolvedMcpTools: toolContext.toolResolution.resolvedMcpTools,
          resolvedTools: toolContext.toolResolution.resolvedTools,
        });

        await logPipelineEvent(logger, context, { step: "agent-execution", status: "started" });
        const executionContext = await executeAgentStage(toolContext, {
          createAgent: dependencies.createAgent,
          getApiKey: dependencies.getApiKey,
        });
        await logPipelineEvent(logger, context, { step: "agent-execution", status: "completed" });

        await logPipelineEvent(logger, context, {
          step: "pipeline",
          status: "completed",
          durationMs: Date.now() - startedAt,
        });

        await hookRunner.run(
          "onAgentEngineRunSuccess",
          (hooks) => hooks.onAgentEngineRunSuccess,
          {
            input,
            result: executionContext.result,
            durationMs: Date.now() - startedAt,
          },
        );

        return executionContext.result;
      } catch (error) {
        await logPipelineEvent(logger, context, {
          step: "pipeline",
          status: "failed",
          durationMs: Date.now() - startedAt,
          errorType: error instanceof Error ? error.name : typeof error,
          error,
        });
        await hookRunner.runErrorHook(
          "onAgentEngineRunError",
          (hooks) => hooks.onAgentEngineRunError,
          {
            input,
            error,
            durationMs: Date.now() - startedAt,
          },
        );
        throw error;
      }
    },
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      await mcpToolCache.close();
    },
  };
}

async function logSystemPromptSources(
  logger: Logger | undefined,
  context: EngineLogContext,
  resolution: SystemPromptResolutionResult,
): Promise<void> {
  const sources = resolution.sources;
  await logger?.debug("resolved system prompt sources", {
    ...context,
    cacheHit: resolution.cacheHit,
    basePromptSource: sources.basePromptSource,
    ...(sources.basePromptFile ? { basePromptFile: sources.basePromptFile } : {}),
    ...(sources.basePromptBuiltIn ? { basePromptBuiltIn: sources.basePromptBuiltIn } : {}),
    instructionFileCount: sources.instructionFiles.length,
    instructionFiles: sources.instructionFiles,
    configuredInstructionFileCount: sources.configuredInstructionFiles.length,
    configuredInstructionFiles: sources.configuredInstructionFiles,
    agentHomeInstructionFileCount: sources.agentHomeInstructionFiles.length,
    agentHomeInstructionFiles: sources.agentHomeInstructionFiles,
    ...(sources.workspaceInstructionFile ? { workspaceInstructionFile: sources.workspaceInstructionFile } : {}),
    referenceFileCount: sources.referenceFiles.length,
    referenceFiles: sources.referenceFiles,
    configuredReferenceFileCount: sources.configuredReferenceFiles.length,
    configuredReferenceFiles: sources.configuredReferenceFiles,
  });
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

export {
  createBuiltInToolRegistry,
  mergeShellPathEntries,
  resolveAgentTools,
  resolveWorkingDirectory,
  type WorkingDirectoryState,
} from "./tool-resolution.js";
