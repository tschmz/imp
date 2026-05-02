import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationContext } from "../../domain/conversation.js";
import type { IncomingMessage } from "../../domain/message.js";
import { createToolRegistry } from "../../tools/registry.js";
import type { ToolDefinition } from "../../tools/types.js";
import { buildRuntimeComponents } from "./build-runtime-components.js";
import type { DaemonConfig, RuntimePaths } from "../types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("buildRuntimeComponents", () => {
  it("preserves runtime tool resolution context when merging plugin tools", async () => {
    const root = await createTempDir();
    const endpointConfig = createEndpointConfig(root);
    const pluginTool = createPluginTool();
    const receivedCalls: Array<{
      hasAttachmentCollector: boolean;
      dataRoot?: string;
      sessionId?: string;
    }> = [];
    const components = buildRuntimeComponents(
      {
        configPath: join(root, "config.json"),
        logging: {
          level: "error",
          rotationSize: "5M",
        },
        agents: [],
        activeEndpoints: [endpointConfig],
        pluginTools: [pluginTool],
      },
      endpointConfig,
      {
        createBuiltInToolRegistry: (_workingDirectory, _agent, attachmentCollector, context) => {
          receivedCalls.push({
            hasAttachmentCollector: Boolean(attachmentCollector),
            ...(context?.dataRoot ? { dataRoot: context.dataRoot } : {}),
            ...(context?.conversation?.state.conversation.sessionId
              ? { sessionId: context.conversation.state.conversation.sessionId }
              : {}),
          });
          return createToolRegistry([]);
        },
      },
    );

    const surface = await components.resolveAgentRuntimeSurface({
      agent: {
        id: "default",
        name: "Default",
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
        model: {
          provider: "test",
          modelId: "stub",
        },
        tools: ["plugin_echo"],
        extensions: [],
      },
      conversation: createConversation(),
      message: createIncomingMessage(),
      runtimeInfo: {
        endpointId: "private-telegram",
        configPath: join(root, "config.json"),
        dataRoot: root,
        logFilePath: endpointConfig.paths.logFilePath,
        loggingLevel: "error",
        activeEndpointIds: ["private-telegram"],
      },
    });

    expect(surface.tools).toEqual(["plugin_echo"]);
    expect(receivedCalls).toEqual([
      {
        hasAttachmentCollector: true,
        dataRoot: root,
        sessionId: "session-1",
      },
    ]);
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-runtime-components-test-"));
  tempDirs.push(path);
  return path;
}

function createRuntimePaths(root: string): RuntimePaths {
  return {
    dataRoot: root,
    sessionsDir: join(root, "sessions"),
    bindingsDir: join(root, "bindings"),
    logsDir: join(root, "logs"),
    logFilePath: join(root, "logs", "endpoints.log"),
    runtimeDir: join(root, "runtime", "endpoints"),
    runtimeStatePath: join(root, "runtime", "endpoints", "private-telegram.json"),
  };
}

function createEndpointConfig(root: string): DaemonConfig["activeEndpoints"][number] {
  return {
    id: "private-telegram",
    type: "telegram",
    token: "telegram-token",
    allowedUserIds: ["7"],
    defaultAgentId: "default",
    paths: createRuntimePaths(root),
  };
}

function createConversation(): ConversationContext {
  return {
    state: {
      conversation: {
        transport: "telegram",
        externalId: "42",
        sessionId: "session-1",
      },
      agentId: "default",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
      version: 1,
    },
    messages: [],
  };
}

function createIncomingMessage(): IncomingMessage {
  return {
    endpointId: "private-telegram",
    conversation: {
      transport: "telegram",
      externalId: "42",
    },
    messageId: "1",
    correlationId: "corr-1",
    userId: "7",
    text: "hello",
    receivedAt: "2026-04-05T00:00:00.000Z",
  };
}

function createPluginTool(): ToolDefinition {
  return {
    name: "plugin_echo",
    label: "Echo",
    description: "Echo input.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      return {
        content: [{ type: "text", text: "ok" }],
        details: {},
      };
    },
  };
}
