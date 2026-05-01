import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../../config/types.js";
import type { ConversationStore } from "../../storage/types.js";
import { agentCommandHandler } from "./agent-command.js";
import {
  createCommandContext,
  createDependencies,
  createIncomingMessage,
} from "./test-helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("agentCommandHandler", () => {
  it("switches the chat to the requested agent active session without mutating the prior session", async () => {
    const sessions = new Map([
      ["default", {
      state: {
        conversation: { transport: "telegram", externalId: "42", sessionId: "session-1" },
        agentId: "default",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        version: 1,
      },
      messages: [],
      }],
    ]);
    let selectedAgentId = "default";
    const store: ConversationStore = {
      get: async () => sessions.get(selectedAgentId),
      put: async () => {},
      listBackups: async () => [],
      restore: async () => false,
      ensureActive: async () => {
        throw new Error("legacy ensureActive should not be used");
      },
      create: async () => {
        throw new Error("legacy create should not be used");
      },
      getSelectedAgent: async () => selectedAgentId,
      setSelectedAgent: async (_ref, agentId) => {
        selectedAgentId = agentId;
      },
      getActiveForAgent: async (agentId) => sessions.get(agentId),
      listBackupsForAgent: async () => [],
      restoreForAgent: async () => false,
      ensureActiveForAgent: async (ref, options) => {
        selectedAgentId = options.agentId;
        const existing = sessions.get(options.agentId);
        if (existing) {
          return existing;
        }

        const created = {
          state: {
            conversation: { ...ref, sessionId: "session-2" },
            agentId: options.agentId,
            createdAt: options.now,
            updatedAt: options.now,
            version: 1,
          },
          messages: [],
        };
        sessions.set(options.agentId, created);
        return created;
      },
      createForAgent: async () => {
        throw new Error("createForAgent should not be used");
      },
    };
    const context = createCommandContext({
      message: createIncomingMessage("agent", "ops"),
      dependencies: createDependencies({ conversationStore: store }),
    });

    const response = await agentCommandHandler.handle(context);

    expect(agentCommandHandler.canHandle("agent")).toBe(true);
    expect(response?.text).toContain("Switched to `ops` (ops).");
    expect(sessions.get("default")?.state.agentId).toBe("default");
    expect(await store.getSelectedAgent!(context.message.conversation)).toBe("ops");
    expect((await store.get(context.message.conversation))?.state.conversation.sessionId).toBe("session-2");
  });

  it("lists plugin agents configured on disk even before the daemon reloads", async () => {
    const { appConfig, configPath, dataRoot } = await createPluginAgentConfig();
    const context = createCommandContext({
      message: createIncomingMessage("agent"),
      dependencies: createDependencies({
        runtimeInfo: {
          endpointId: "private-telegram",
          configPath,
          dataRoot,
          logFilePath: join(dirname(configPath), "endpoint.log"),
          loggingLevel: "info",
          activeEndpointIds: ["private-telegram"],
        },
      }),
      loadAppConfig: async () => appConfig,
    });

    const response = await agentCommandHandler.handle(context);

    expect(response?.text).toContain("`default`, `ops`, `imp-agents.cody`");
  });

  it("tells the user to reload before switching to a newly configured plugin agent", async () => {
    const { appConfig, configPath, dataRoot } = await createPluginAgentConfig();
    const context = createCommandContext({
      message: createIncomingMessage("agent", "imp-agents.cody"),
      dependencies: createDependencies({
        runtimeInfo: {
          endpointId: "private-telegram",
          configPath,
          dataRoot,
          logFilePath: join(dirname(configPath), "endpoint.log"),
          loggingLevel: "info",
          activeEndpointIds: ["private-telegram"],
        },
      }),
      loadAppConfig: async () => appConfig,
    });

    const response = await agentCommandHandler.handle(context);

    expect(response?.text).toContain("`imp-agents.cody` is configured but this daemon has not loaded it yet.");
    expect(response?.text).toContain("Next: `/reload`");
    expect(response?.text).toContain("`default`, `ops`, `imp-agents.cody`");
  });
});

async function createPluginAgentConfig(): Promise<{ appConfig: AppConfig; configPath: string; dataRoot: string }> {
  const root = await createTempDir();
  const dataRoot = join(root, "state");
  const pluginRoot = join(dataRoot, "plugins", "imp-agents");
  await writeRawFile(join(pluginRoot, "imp-plugin.json"), JSON.stringify({
    schemaVersion: 1,
    id: "imp-agents",
    name: "Imp Agent Pack",
    version: "0.1.0",
    agents: [
      {
        id: "cody",
        model: { provider: "openai", modelId: "gpt-5.4" },
        prompt: { base: { text: "Cody" } },
      },
    ],
  }, null, 2));

  return {
    appConfig: createAppConfig(dataRoot),
    configPath: join(root, "config.json"),
    dataRoot,
  };
}

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-agent-command-test-"));
  tempDirs.push(path);
  return path;
}

async function writeRawFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function createAppConfig(dataRoot: string): AppConfig {
  return {
    instance: { name: "test" },
    paths: { dataRoot },
    defaults: { agentId: "default" },
    agents: [
      {
        id: "default",
        model: { provider: "openai", modelId: "gpt-5.4" },
        prompt: { base: { text: "Default" } },
        tools: [],
      },
    ],
    endpoints: [
      {
        id: "private-telegram",
        type: "telegram",
        enabled: true,
        token: "telegram-token",
        access: { allowedUserIds: [] },
      },
    ],
  };
}
