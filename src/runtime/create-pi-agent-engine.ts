import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Agent, type AgentMessage, type AgentOptions } from "@mariozechner/pi-agent-core";
import {
  createCodingTools,
  createFindTool,
  createGrepTool,
  createLsTool,
} from "@mariozechner/pi-coding-agent";
import {
  getModel,
  type Api as AiApi,
  type AssistantMessage,
  type Model,
  type StreamOptions,
  type Usage,
  type UserMessage,
} from "@mariozechner/pi-ai";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationMessage } from "../domain/conversation.js";
import type { Logger } from "../logging/types.js";
import { createToolRegistry, type ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition } from "../tools/types.js";
import type { AgentEngine } from "./types.js";

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

interface PiAgentEngineDependencies {
  logger?: Logger;
  resolveModel?: (provider: string, modelId: string) => Model<AiApi> | undefined;
  getApiKey?: (
    provider: string,
    agent: AgentDefinition,
  ) => Promise<string | undefined> | string | undefined;
  createAgent?: (options: AgentOptions) => AgentHandle;
  readTextFile?: (path: string) => Promise<string>;
  getContextFileFingerprint?: (path: string) => Promise<string>;
  toolRegistry?: ToolRegistry;
  createBuiltInToolRegistry?: (workingDirectory: string) => ToolRegistry;
}

interface AgentHandle {
  prompt(text: string): Promise<void>;
  state: {
    messages: AgentMessage[];
  };
}

export function createPiAgentEngine(
  dependencies: PiAgentEngineDependencies = {},
): AgentEngine {
  const resolveModel = dependencies.resolveModel ?? defaultResolveModel;
  const createAgent = dependencies.createAgent ?? defaultCreateAgent;
  const readTextFile = dependencies.readTextFile ?? defaultReadTextFile;
  const getContextFileFingerprint =
    dependencies.getContextFileFingerprint ?? defaultGetContextFileFingerprint;
  const buildToolRegistry =
    dependencies.createBuiltInToolRegistry ?? createBuiltInToolRegistry;
  const getApiKey = dependencies.getApiKey;
  const systemPromptCache = new Map<string, string>();
  const latestSystemPromptCacheKeyByAgentId = new Map<string, string>();
  const logger = dependencies.logger;

  return {
    async run(input) {
      const startedAt = Date.now();
      try {
        const model = resolveModel(input.agent.model.provider, input.agent.model.modelId);
        if (!model) {
          throw new Error(
            `Unknown model for agent "${input.agent.id}": ` +
              `${input.agent.model.provider}/${input.agent.model.modelId}`,
          );
        }
        await logger?.debug("resolved agent model", {
          botId: input.message.botId,
          transport: input.message.conversation.transport,
          conversationId: input.message.conversation.externalId,
          messageId: input.message.messageId,
          correlationId: input.message.correlationId,
          agentId: input.agent.id,
        });

        const systemPrompt = await resolveSystemPrompt({
          agent: input.agent,
          readTextFile,
          getContextFileFingerprint,
          cache: systemPromptCache,
          latestCacheKeyByAgentId: latestSystemPromptCacheKeyByAgentId,
          logger,
        });
        const toolRegistry =
          dependencies.toolRegistry ??
          buildToolRegistry(resolveWorkingDirectory(input.agent));
        const tools = resolveAgentTools(input.agent, toolRegistry);
        await logger?.debug("prepared agent runtime", {
          botId: input.message.botId,
          transport: input.message.conversation.transport,
          conversationId: input.message.conversation.externalId,
          messageId: input.message.messageId,
          correlationId: input.message.correlationId,
          agentId: input.agent.id,
        });
        const onPayload = createOnPayloadOverride(input.agent);
        const agent = createAgent({
          initialState: {
            systemPrompt,
            model,
            thinkingLevel: "off",
            tools,
            messages: toAgentMessages(input.conversation.messages, model),
          },
          ...(getApiKey
            ? {
                getApiKey: (provider: string) => getApiKey(provider, input.agent),
              }
            : {}),
          ...(onPayload ? { onPayload } : {}),
        });

        await agent.prompt(input.message.text);

        const assistantMessage = [...agent.state.messages]
          .reverse()
          .find((message): message is AssistantMessage => message.role === "assistant");

        if (!assistantMessage) {
          throw new Error(`Agent "${input.agent.id}" did not produce an assistant message.`);
        }

        if (assistantMessage.stopReason === "error" || assistantMessage.stopReason === "aborted") {
          throw new Error(
            `Agent "${input.agent.id}" failed: ` +
              `${assistantMessage.errorMessage ?? "unknown upstream error"}`,
          );
        }

        const responseText = getAssistantText(assistantMessage);
        if (!responseText.trim()) {
          throw new Error(`Agent "${input.agent.id}" produced an assistant message without text content.`);
        }

        await logger?.debug("agent engine run completed", {
          botId: input.message.botId,
          transport: input.message.conversation.transport,
          conversationId: input.message.conversation.externalId,
          messageId: input.message.messageId,
          correlationId: input.message.correlationId,
          agentId: input.agent.id,
          durationMs: Date.now() - startedAt,
        });

        return {
          message: {
            conversation: input.message.conversation,
            text: responseText,
          },
        };
      } catch (error) {
        await logger?.error(
          "agent engine run failed",
          {
            botId: input.message.botId,
            transport: input.message.conversation.transport,
            conversationId: input.message.conversation.externalId,
            messageId: input.message.messageId,
            correlationId: input.message.correlationId,
            agentId: input.agent.id,
            durationMs: Date.now() - startedAt,
            errorType: error instanceof Error ? error.name : typeof error,
          },
          error,
        );
        throw error;
      }
    },
  };
}

function defaultResolveModel(provider: string, modelId: string): Model<AiApi> | undefined {
  return getModel(provider as never, modelId as never);
}

function defaultCreateAgent(options: AgentOptions): AgentHandle {
  return new Agent(options);
}

async function defaultReadTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function defaultGetContextFileFingerprint(path: string): Promise<string> {
  const fileStats = await stat(path);
  return `${fileStats.mtimeMs}:${fileStats.size}`;
}

export function resolveWorkingDirectory(agent: AgentDefinition): string {
  return agent.context?.workingDirectory ?? process.cwd();
}

export function createBuiltInToolRegistry(workingDirectory: string): ToolRegistry {
  return createToolRegistry([
    ...createCodingTools(workingDirectory),
    createGrepTool(workingDirectory),
    createFindTool(workingDirectory),
    createLsTool(workingDirectory),
  ]);
}

export function resolveAgentTools(
  agent: AgentDefinition,
  toolRegistry: ToolRegistry,
): ToolDefinition[] {
  if (agent.tools.length === 0) {
    return [];
  }

  const resolvedTools = toolRegistry.pick(agent.tools);
  const resolvedNames = new Set(resolvedTools.map((tool) => tool.name));
  const missingTools = agent.tools.filter((name) => !resolvedNames.has(name));
  if (missingTools.length > 0) {
    throw new Error(
      `Unknown tools for agent "${agent.id}": ${missingTools.join(", ")}`,
    );
  }

  return resolvedTools;
}

function createOnPayloadOverride(
  agent: AgentDefinition,
): StreamOptions["onPayload"] | undefined {
  const maxOutputTokens = agent.inference?.maxOutputTokens;
  const metadata = agent.inference?.metadata;
  const request = agent.inference?.request;
  if (
    metadata === undefined &&
    request === undefined &&
    maxOutputTokens === undefined
  ) {
    return undefined;
  }

  return (payload, model) => {
    if (
      model.api !== "openai-responses" &&
      model.api !== "openai-codex-responses" &&
      model.api !== "azure-openai-responses"
    ) {
      return undefined;
    }

    if (!isRecord(payload)) {
      return undefined;
    }

    return {
      ...payload,
      ...(metadata !== undefined ? { metadata } : {}),
      ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
      ...(request ?? {}),
    };
  };
}

async function buildSystemPrompt(
  agent: AgentDefinition,
  readTextFile: (path: string) => Promise<string>,
): Promise<string> {
  const sections: string[] = [];

  if (agent.systemPromptFile) {
    let content: string;
    try {
      content = await readTextFile(agent.systemPromptFile);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to read system prompt file for agent "${agent.id}": ${agent.systemPromptFile} (${detail})`,
      );
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new Error(
        `System prompt file for agent "${agent.id}" is empty: ${agent.systemPromptFile}`,
      );
    }

    sections.push(trimmedContent);
  } else if (agent.systemPrompt) {
    sections.push(agent.systemPrompt);
  } else {
    throw new Error(`Agent "${agent.id}" must define systemPrompt or systemPromptFile.`);
  }

  const contextFiles = agent.context?.files ?? [];

  for (const path of contextFiles) {
    let content: string;
    try {
      content = await readTextFile(path);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to read context file for agent "${agent.id}": ${path} (${detail})`,
      );
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      continue;
    }

    sections.push(`[Context File: ${path}]\n${trimmedContent}`);
  }

  return sections.join("\n\n");
}

async function resolveSystemPrompt(options: {
  agent: AgentDefinition;
  readTextFile: (path: string) => Promise<string>;
  getContextFileFingerprint: (path: string) => Promise<string>;
  cache: Map<string, string>;
  latestCacheKeyByAgentId: Map<string, string>;
  logger?: Logger;
}): Promise<string> {
  const cacheKey = await buildSystemPromptCacheKey(
    options.agent,
    options.getContextFileFingerprint,
    options.readTextFile,
  );
  const cachedPrompt = options.cache.get(cacheKey);
  if (cachedPrompt !== undefined) {
    await options.logger?.debug("reused cached system prompt", {
      agentId: options.agent.id,
    });
    return cachedPrompt;
  }

  const systemPrompt = await buildSystemPrompt(options.agent, options.readTextFile);
  options.cache.set(cacheKey, systemPrompt);
  await options.logger?.debug("rebuilt system prompt", {
    agentId: options.agent.id,
  });

  const previousCacheKey = options.latestCacheKeyByAgentId.get(options.agent.id);
  if (previousCacheKey !== undefined && previousCacheKey !== cacheKey) {
    options.cache.delete(previousCacheKey);
  }
  options.latestCacheKeyByAgentId.set(options.agent.id, cacheKey);

  return systemPrompt;
}

async function buildSystemPromptCacheKey(
  agent: AgentDefinition,
  getContextFileFingerprint: (path: string) => Promise<string>,
  readTextFile: (path: string) => Promise<string>,
): Promise<string> {
  const promptFiles = [agent.systemPromptFile, ...(agent.context?.files ?? [])].filter(
    (path): path is string => path !== undefined,
  );
  const fileFingerprints = await Promise.all(
    promptFiles.map(async (path) => {
      try {
        const fingerprint = await getContextFileFingerprint(path);
        return `${path}:${fingerprint}`;
      } catch {
        try {
          const content = await readTextFile(path);
          const hash = createHash("sha256").update(content).digest("hex");
          return `${path}:sha256:${hash}`;
        } catch {
          return `${path}:unreadable`;
        }
      }
    }),
  );

  return JSON.stringify({
    agentId: agent.id,
    systemPrompt: agent.systemPrompt,
    systemPromptFile: agent.systemPromptFile,
    files: fileFingerprints,
  });
}

function toAgentMessages(
  messages: ConversationMessage[],
  model: Model<AiApi>,
): Array<UserMessage | AssistantMessage> {
  return messages.reduce<Array<UserMessage | AssistantMessage>>((result, message) => {
    if (message.role === "user") {
      result.push(toUserMessage(message));
      return result;
    }

    if (message.role === "assistant") {
      result.push(toAssistantMessage(message, model));
      return result;
    }

    return result;
  }, []);
}

function toUserMessage(message: ConversationMessage): UserMessage {
  return {
    role: "user",
    content: message.text,
    timestamp: Date.parse(message.createdAt),
  };
}

function toAssistantMessage(message: ConversationMessage, model: Model<AiApi>): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: message.text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: "stop",
    timestamp: Date.parse(message.createdAt),
  };
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
