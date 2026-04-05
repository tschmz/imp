import { readFile } from "node:fs/promises";
import { Agent, type AgentOptions } from "@mariozechner/pi-agent-core";
import {
  getModel,
  type Api as AiApi,
  type AssistantMessage,
  type Message,
  type Model,
  type StreamOptions,
  type Usage,
  type UserMessage,
} from "@mariozechner/pi-ai";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationMessage } from "../domain/conversation.js";
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
  resolveModel?: (provider: string, modelId: string) => Model<AiApi> | undefined;
  createAgent?: (options: AgentOptions) => AgentHandle;
  readTextFile?: (path: string) => Promise<string>;
}

interface AgentHandle {
  prompt(text: string): Promise<void>;
  state: {
    messages: Message[];
  };
}

export function createPiAgentEngine(
  dependencies: PiAgentEngineDependencies = {},
): AgentEngine {
  const resolveModel = dependencies.resolveModel ?? defaultResolveModel;
  const createAgent = dependencies.createAgent ?? defaultCreateAgent;
  const readTextFile = dependencies.readTextFile ?? defaultReadTextFile;

  return {
    async run(input) {
      const model = resolveModel(input.agent.model.provider, input.agent.model.modelId);
      if (!model) {
        throw new Error(
          `Unknown model for agent "${input.agent.id}": ` +
            `${input.agent.model.provider}/${input.agent.model.modelId}`,
        );
      }

      const systemPrompt = await buildSystemPrompt(input.agent, readTextFile);
      const onPayload = createOnPayloadOverride(input.agent);
      const agent = createAgent({
        initialState: {
          systemPrompt,
          model,
          thinkingLevel: "off",
          tools: [],
          messages: toAgentMessages(input.conversation.messages, model),
        },
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

      return {
        message: {
          conversation: input.message.conversation,
          text: responseText,
        },
      };
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
  const sections = [agent.systemPrompt];
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
